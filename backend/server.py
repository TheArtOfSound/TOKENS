import os
import json
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent / "public" / "data"

load_dotenv(ROOT / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
INGEST_SECRET = os.environ.get("INGEST_SECRET")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Live drift: tokens accumulate continuously so the observatory feels alive.
# Drift is ONLY applied to the seeded demo snapshot. Real snapshots pushed via
# /api/usage/ingest show their true, un-inflated numbers (evidence, not hype).
FRESH_RATE = 1550.0      # fresh tokens / second
CACHED_RATE = 17300.0    # cached (read) tokens / second
COST_RATE = 0.0023       # estimated USD / second
TOTAL_RATE = FRESH_RATE + CACHED_RATE


# ---------------------------------------------------------------------------
# Ingest schema (validated payload from the local Mac publisher)
# ---------------------------------------------------------------------------
class TokenMetrics(BaseModel):
    model_config = ConfigDict(extra="allow")
    inputTokens: int = 0
    outputTokens: int = 0
    cacheCreationTokens: int = 0
    cacheReadTokens: int = 0
    cachedTokens: int = 0
    freshTokens: int = 0
    totalTokens: int = 0
    estimatedCostUsd: Optional[float] = None


class ProviderSummary(TokenMetrics):
    provider: str
    displayName: str
    models: List[str] = Field(default_factory=list)


class DailyUsage(TokenMetrics):
    date: str
    provider: str
    displayName: Optional[str] = None
    models: List[str] = Field(default_factory=list)


class SnapshotVerification(BaseModel):
    model_config = ConfigDict(extra="allow")
    schemaVersion: str
    snapshotSha256: Optional[str] = None
    rawLogsPublished: bool = False
    gitCommit: Optional[str] = None


class IngestSnapshot(BaseModel):
    """Sanitized snapshot pushed by the local collector. Extra keys allowed."""
    model_config = ConfigDict(extra="allow")
    generatedAt: str
    timezone: str
    source: str
    collectorVersion: str
    isSampleData: bool = False
    totals: TokenMetrics
    providers: Dict[str, ProviderSummary] = Field(default_factory=dict)
    daily: List[DailyUsage] = Field(default_factory=list)
    qiraProjects: Optional[List[Dict[str, Any]]] = None
    scanner: Optional[Dict[str, Any]] = None
    warnings: List[str] = Field(default_factory=list)
    verification: SnapshotVerification


def _now():
    return datetime.now(timezone.utc)


def _parse_iso(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return _now()


def _load_json(name):
    path = DATA_DIR / name
    if not path.exists():
        return None
    return json.loads(path.read_text())


async def seed_if_empty():
    existing = await db.snapshots.find_one({"_id": "latest"})
    if existing:
        return
    latest = _load_json("latest.json") or {}
    latest["_id"] = "latest"
    latest["liveAnchor"] = _now().isoformat()
    latest["simulateDrift"] = True  # seeded demo data: animate it live
    await db.snapshots.replace_one({"_id": "latest"}, latest, upsert=True)

    history = _load_json("history.json") or []
    if isinstance(history, list) and history:
        await db.history.delete_many({})
        await db.history.insert_many(
            [{"index": i, "snapshot": h} for i, h in enumerate(history)]
        )


def apply_drift(snap):
    anchor = _parse_iso(snap.get("liveAnchor", snap.get("generatedAt", _now().isoformat())))
    now = _now()
    elapsed = max(0.0, (now - anchor).total_seconds())

    # Real ingested snapshots are shown verbatim (no simulated growth).
    if not snap.get("simulateDrift", False):
        snap["live"] = {
            "anchor": anchor.isoformat(),
            "elapsedSeconds": round(elapsed, 1),
            "totalRatePerSecond": 0,
            "freshRatePerSecond": 0,
            "cachedRatePerSecond": 0,
            "sessionTokens": 0,
            "mode": "real",
        }
        return snap

    fresh_add = int(elapsed * FRESH_RATE)
    cached_add = int(elapsed * CACHED_RATE)
    total_add = fresh_add + cached_add
    cost_add = elapsed * COST_RATE

    t = snap.get("totals", {})
    t["freshTokens"] = t.get("freshTokens", 0) + fresh_add
    t["inputTokens"] = t.get("inputTokens", 0) + int(fresh_add * 0.05)
    t["outputTokens"] = t.get("outputTokens", 0) + int(fresh_add * 0.95)
    t["cachedTokens"] = t.get("cachedTokens", 0) + cached_add
    t["cacheReadTokens"] = t.get("cacheReadTokens", 0) + cached_add
    t["totalTokens"] = t.get("totalTokens", 0) + total_add
    if t.get("estimatedCostUsd") is not None:
        t["estimatedCostUsd"] = t["estimatedCostUsd"] + cost_add

    for key, frac in (("claude", 0.62), ("codex", 0.38)):
        p = snap.get("providers", {}).get(key)
        if not p:
            continue
        p["freshTokens"] = p.get("freshTokens", 0) + int(fresh_add * frac)
        p["cachedTokens"] = p.get("cachedTokens", 0) + int(cached_add * frac)
        p["cacheReadTokens"] = p.get("cacheReadTokens", 0) + int(cached_add * frac)
        p["totalTokens"] = p.get("totalTokens", 0) + int(total_add * frac)
        if key == "claude" and p.get("estimatedCostUsd") is not None:
            p["estimatedCostUsd"] = p["estimatedCostUsd"] + cost_add

    daily = snap.get("daily") or []
    if daily:
        last = daily[-1]
        last["totalTokens"] = last.get("totalTokens", 0) + total_add
        last["freshTokens"] = last.get("freshTokens", 0) + fresh_add
        last["cachedTokens"] = last.get("cachedTokens", 0) + cached_add

    snap["generatedAt"] = now.isoformat()
    snap["live"] = {
        "anchor": anchor.isoformat(),
        "elapsedSeconds": round(elapsed, 1),
        "totalRatePerSecond": TOTAL_RATE,
        "freshRatePerSecond": FRESH_RATE,
        "cachedRatePerSecond": CACHED_RATE,
        "sessionTokens": total_add,
        "mode": "simulated",
    }
    return snap


def aggregate_daily(daily):
    buckets = {}
    for row in daily or []:
        date = row.get("date")
        if not date:
            continue
        b = buckets.setdefault(
            date,
            {"date": date, "totalTokens": 0, "freshTokens": 0, "cachedTokens": 0, "claude": 0, "codex": 0},
        )
        b["totalTokens"] += row.get("totalTokens", 0)
        b["freshTokens"] += row.get("freshTokens", 0)
        b["cachedTokens"] += row.get("cachedTokens", 0)
        prov = row.get("provider")
        if prov in ("claude", "codex"):
            b[prov] += row.get("totalTokens", 0)
    return sorted(buckets.values(), key=lambda x: x["date"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_if_empty()
    yield
    client.close()


app = FastAPI(title="Qira Agent Usage Observatory API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def get_live_snapshot():
    snap = await db.snapshots.find_one({"_id": "latest"})
    if not snap:
        await seed_if_empty()
        snap = await db.snapshots.find_one({"_id": "latest"})
    snap.pop("_id", None)
    return apply_drift(snap)


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": _now().isoformat()}


@app.get("/api/usage/latest")
async def usage_latest():
    snap = await get_live_snapshot()
    daily = snap.pop("daily", [])
    snap["dailyAgg"] = aggregate_daily(daily)[-30:]
    return snap


@app.get("/api/usage/history")
async def usage_history():
    docs = await db.history.find().sort("index", 1).to_list(length=500)
    series = []
    for d in docs:
        s = d.get("snapshot", {})
        totals = s.get("totals", {})
        series.append(
            {
                "generatedAt": s.get("generatedAt"),
                "totalTokens": totals.get("totalTokens", 0),
                "cachedTokens": totals.get("cachedTokens", 0),
                "freshTokens": totals.get("freshTokens", 0),
                "estimatedCostUsd": totals.get("estimatedCostUsd"),
            }
        )
    return {"count": len(series), "series": series}


@app.get("/api/projects")
async def projects():
    snap = await db.snapshots.find_one({"_id": "latest"})
    if not snap:
        return {"projects": [], "scanner": {}}
    return {"projects": snap.get("qiraProjects", []), "scanner": snap.get("scanner", {})}


@app.post("/api/usage/ingest")
async def ingest(
    snapshot: IngestSnapshot,
    x_ingest_token: Optional[str] = Header(default=None),
):
    """Local Mac publisher pushes a fresh sanitized snapshot here to go live.

    Requires the `X-Ingest-Token` header to match the server's INGEST_SECRET.
    Ingested snapshots are stored verbatim (no simulated drift).
    """
    if not INGEST_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Ingest endpoint not configured: INGEST_SECRET is missing on the server.",
        )
    if not x_ingest_token or x_ingest_token != INGEST_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Ingest-Token.")

    payload = snapshot.model_dump()
    payload["_id"] = "latest"
    payload["liveAnchor"] = _now().isoformat()
    payload["simulateDrift"] = False  # real data is shown as-is
    await db.snapshots.replace_one({"_id": "latest"}, payload, upsert=True)

    clean = {k: v for k, v in payload.items() if k != "_id"}
    count = await db.history.count_documents({})
    await db.history.insert_one({"index": count, "snapshot": clean})
    return {"status": "ingested", "generatedAt": payload.get("generatedAt"), "mode": "real"}

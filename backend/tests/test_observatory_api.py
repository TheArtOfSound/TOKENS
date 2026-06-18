"""
Backend tests for Qira Agent Usage Observatory.
Covers health, /api/usage/latest (shape + LIVE DRIFT), /api/usage/history,
/api/projects and POST /api/usage/ingest.
"""

import os
import time
import json
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
# Fallback to frontend env if backend env did not propagate to test env
if not BASE_URL:
    try:
        from pathlib import Path
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
    except Exception:
        pass

assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- /api/health ----------
def test_health(session):
    r = session.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "time" in body


# ---------- /api/usage/latest shape ----------
def test_usage_latest_shape(session):
    r = session.get(f"{API}/usage/latest", timeout=15)
    assert r.status_code == 200, r.text
    snap = r.json()

    # totals
    totals = snap.get("totals")
    assert isinstance(totals, dict)
    for k in ("totalTokens", "freshTokens", "cachedTokens", "estimatedCostUsd"):
        assert k in totals, f"missing totals.{k}"
    assert isinstance(totals["totalTokens"], int)
    assert totals["totalTokens"] > 0

    # providers (claude + codex)
    providers = snap.get("providers")
    assert isinstance(providers, dict)
    assert "claude" in providers
    assert "codex" in providers

    # dailyAgg
    daily = snap.get("dailyAgg")
    assert isinstance(daily, list)
    assert len(daily) <= 30
    if daily:
        d0 = daily[0]
        assert "date" in d0 and "totalTokens" in d0

    # qiraProjects (8)
    projects = snap.get("qiraProjects")
    assert isinstance(projects, list)
    assert len(projects) == 8, f"expected 8 projects, got {len(projects)}"

    # scanner + verification + live
    assert isinstance(snap.get("scanner"), dict)
    assert isinstance(snap.get("verification"), dict)
    live = snap.get("live")
    assert isinstance(live, dict)
    for k in ("anchor", "elapsedSeconds", "totalRatePerSecond", "sessionTokens"):
        assert k in live, f"missing live.{k}"


# ---------- LIVE DRIFT (the headline) ----------
def test_usage_latest_live_drift(session):
    r1 = session.get(f"{API}/usage/latest", timeout=15)
    assert r1.status_code == 200
    snap1 = r1.json()
    total1 = snap1["totals"]["totalTokens"]
    session1 = snap1["live"]["sessionTokens"]

    time.sleep(3.2)

    r2 = session.get(f"{API}/usage/latest", timeout=15)
    assert r2.status_code == 200
    snap2 = r2.json()
    total2 = snap2["totals"]["totalTokens"]
    session2 = snap2["live"]["sessionTokens"]

    delta = total2 - total1
    # ~18,850 tokens/sec * 3s ~= 56k. Allow a generous floor of 30k.
    assert delta >= 30_000, f"live drift too small: {delta} (t1={total1}, t2={total2})"
    assert session2 > session1, "sessionTokens must grow between polls"


# ---------- /api/usage/history ----------
def test_usage_history(session):
    r = session.get(f"{API}/usage/history", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "count" in body and "series" in body
    assert isinstance(body["series"], list)
    assert body["count"] == len(body["series"])
    if body["series"]:
        entry = body["series"][0]
        assert "totalTokens" in entry
        assert "generatedAt" in entry


# ---------- /api/projects ----------
def test_projects(session):
    r = session.get(f"{API}/projects", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "projects" in body and "scanner" in body
    assert isinstance(body["projects"], list)
    assert len(body["projects"]) == 8


# ---------- POST /api/usage/ingest ----------
def test_usage_ingest_then_reflect(session):
    payload = {
        "generatedAt": "2026-06-18T10:00:00Z",
        "timezone": "America/Phoenix",
        "source": "local_mac_sanitized_ccusage",
        "collectorVersion": "9.9.9",
        "totals": {
            "inputTokens": 1,
            "outputTokens": 1,
            "cacheCreationTokens": 0,
            "cacheReadTokens": 0,
            "cachedTokens": 0,
            "freshTokens": 2,
            "totalTokens": 2,
            "estimatedCostUsd": 1.0,
        },
        "providers": {},
        "daily": [],
        "qiraProjects": [],
        "scanner": {},
        "warnings": [],
        "verification": {
            "schemaVersion": "1.1.0",
            "snapshotSha256": "test",
            "rawLogsPublished": False,
            "gitCommit": None,
        },
    }

    # History count before
    h_before = session.get(f"{API}/usage/history", timeout=15).json().get("count", 0)

    r = session.post(f"{API}/usage/ingest", data=json.dumps(payload), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "ingested"
    assert body.get("generatedAt") == payload["generatedAt"]

    # latest should reflect ingest (allow drift to add tokens after anchor reset)
    r2 = session.get(f"{API}/usage/latest", timeout=15)
    assert r2.status_code == 200
    snap = r2.json()
    # generatedAt is updated by drift to "now", so check live.anchor refers to fresh anchor
    # The simplest invariant: totals.totalTokens just after ingest must be close to seeded 2
    # plus small drift. Should be well under 1 million (vs ~30B before).
    assert snap["totals"]["totalTokens"] < 5_000_000, (
        f"totals.totalTokens looks like it did not reset on ingest: {snap['totals']['totalTokens']}"
    )

    # history should have grown
    h_after = session.get(f"{API}/usage/history", timeout=15).json().get("count", 0)
    assert h_after == h_before + 1

    # Restore: re-ingest the original sanitized snapshot so the dashboard stays rich.
    try:
        from pathlib import Path
        original = json.loads(Path("/app/public/data/latest.json").read_text())
        rs = session.post(f"{API}/usage/ingest", data=json.dumps(original), timeout=15)
        assert rs.status_code == 200
    except Exception as exc:  # pragma: no cover - cleanup best-effort
        print(f"WARN: could not restore original snapshot: {exc}")

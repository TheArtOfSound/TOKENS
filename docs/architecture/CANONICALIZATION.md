# TOKENS — Snapshot Canonicalization & Signature Verification

A signature only means something if someone other than its author can check it.
This document specifies the exact bytes that are signed, so a verifier written in
Python, Rust, Go, or anything else can reproduce them without reading our
TypeScript.

Reference implementation: [`collector/lib/canonicalJson.ts`](../../collector/lib/canonicalJson.ts).
Verifier CLI: `npm run verify -- <path>`.

## 1. Canonical JSON

A subset of RFC 8785 (JSON Canonicalization Scheme), sufficient for the value
types that appear in a snapshot.

| Rule | Behavior |
| --- | --- |
| Object keys | Sorted ascending by UTF-16 code unit (so `"A"` < `"a"` < `"b"`) |
| Whitespace | None. No spaces, no newlines, anywhere |
| `undefined` object members | Omitted entirely |
| `undefined` / holes in arrays | Serialized as `null` |
| Array order | Preserved exactly; never sorted |
| Numbers | ECMAScript `Number::toString`; `-0` normalized to `0` |
| Non-finite numbers | **Rejected** — `NaN`/`Infinity` have no JSON form |
| Strings | `"` `\` and the C0 control characters escaped; `\b \f \n \r \t` use short forms, other controls use `\u00XX` |

## 2. What is signed

1. Take the published snapshot object.
2. **Remove the top-level `signature` member.** Everything else is included.
3. Canonicalize the result per §1 → `payloadBytes`.
4. `payloadSha256 = SHA-256(payloadBytes)`, lowercase hex.

Then build the *bound header* — this is what the Ed25519 signature actually
covers, so the nonce, scope, and issuance time are protected too, not just the
content:

```json
{"algorithm":"ed25519","issuedAt":"<ISO-8601>","keyId":"<16 hex>","nonce":"<uuid>","payloadSha256":"<64 hex>","scope":"published_snapshot","signatureVersion":"1.0.0"}
```

(Shown expanded for readability; canonically it has no whitespace and these exact
key positions, since the keys are already in sorted order.)

5. `signature = base64( Ed25519_sign(privateKey, utf8(boundHeader)) )`

## 3. How to verify

1. Parse the snapshot JSON.
2. Extract the `signature` object; read `publicKey` (base64 SPKI DER).
3. Recompute `payloadSha256` per §2 steps 1–4 from the file's own contents.
4. **Compare** it to `signature.payloadSha256`. Mismatch ⇒ the data was modified.
5. Rebuild the bound header per §2 using the manifest's own field values.
6. Ed25519-verify `signature.signature` over that header with `publicKey`.

Both checks must pass. Step 4 catches edits to the data; step 6 catches edits to
the manifest itself and proves possession of the private key.

### Minimal Python verifier

```python
import base64, hashlib, json
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.exceptions import InvalidSignature

def canon(v):
    if v is None:  return "null"
    if v is True:  return "true"
    if v is False: return "false"
    if isinstance(v, str):   return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, (int, float)):
        if v != v or v in (float("inf"), float("-inf")): raise ValueError("non-finite")
        return json.dumps(v)
    if isinstance(v, list):  return "[" + ",".join(canon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{canon(k)}:{canon(v[k])}" for k in sorted(v)) + "}"
    raise TypeError(type(v))

snap = json.load(open("latest.json"))
sig  = snap.pop("signature")
assert hashlib.sha256(canon(snap).encode()).hexdigest() == sig["payloadSha256"], "data modified"

header = canon({k: sig[k] for k in
    ("algorithm","issuedAt","keyId","nonce","payloadSha256","scope","signatureVersion")})
load_der_public_key(base64.b64decode(sig["publicKey"])).verify(
    base64.b64decode(sig["signature"]), header.encode())
print("VALID")
```

> Note: Python's `sorted()` on `str` compares by code point, which differs from
> UTF-16 code-unit order only for characters above the BMP. Snapshot keys are
> ASCII, so the two agree here.

## 4. What the signature proves — and does not

**Proves:** this snapshot was produced by a collector holding this device's
private key, and has not been altered by a single byte since it was signed.

**Does not prove:**

- **Not log authenticity.** Anyone controlling the machine could feed the
  collector fabricated provider logs. The signature attests to what the collector
  emitted, not to the truth of its inputs.
- **Not human identity.** The key identifies a device, not a person. There is no
  identity verification in this system.
- **Not third-party audit.** This is a self-attestation. It is meaningful for
  detecting tampering in transit or at rest, not as an independent endorsement.

These limits are published inside every signature block (`proves` /
`doesNotProve`) so a viewer sees them without reading this document.

## 5. Key management

- **Storage:** macOS Keychain (`com.qira.tokens.device-key`); falls back to a
  `0600` file at `.tokens-cache/device-key.pem`. The private key is never
  published, logged, or included in any payload.
- **`keyId`:** first 16 hex chars of `SHA-256(base64(publicKey SPKI DER))`.
- **Rotation:** delete the Keychain item (or the PEM) and re-run the collector; a
  new key is generated and the new `keyId` appears in subsequent snapshots.
- **Revocation:** not yet implemented. There is no published revocation list, so
  a compromised key cannot currently be repudiated. Tracked as a known limitation.

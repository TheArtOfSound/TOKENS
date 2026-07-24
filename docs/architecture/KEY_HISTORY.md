# Key rotation, revocation, and history

A device signature proves a snapshot is authentic and unaltered. Keys change over
time — rotated routinely, or revoked after a suspected compromise — and a rotated
key must not make its own past snapshots unverifiable. This is how the states are
distinguished.

## Published files

- `data/key-history.json` — every key this member has signed with, with a status.
- `data/revoked-keys.json` — the revocation list (published separately so a
  compromised key cannot ship a snapshot carrying an empty list).

Both are served from the member's own origin. A verifier applies them without
contacting us.

## `key-history.json`

```json
{
  "updatedAt": "2026-07-24T…",
  "activeKeyId": "defe470fe73a66c6",
  "keys": [
    {
      "keyId": "…",
      "publicKey": "…base64 SPKI…",
      "firstSeen": "2026-07-…",
      "status": "active | rotated | revoked",
      "revokedAt": null,
      "reason": null
    }
  ]
}
```

## Signing states of a snapshot

Given a snapshot's `signature.keyId`, cross-referenced with the two files above:

| State | Meaning | Trust |
| --- | --- | --- |
| **Signed by active key** | keyId is the current active key | Full |
| **Signed by rotated key** | keyId was retired but never revoked | Still trusted for its own era |
| **Signed before revocation** | keyId later revoked, snapshot predates `revokedAt` | Interpret with care |
| **Signed by revoked key** | keyId is on the revocation list | **Rejected** — treated as invalid |
| **Signature invalid** | bytes don't verify against the embedded key | Rejected |
| **Unsigned** | no signature block | Unverified |
| **Key history unavailable** | key-history.json missing/unreachable | Can't interpret rotation state |

The key rule: **a revoked key changes the interpretation of history; it does not
erase it.** Routine rotation leaves old snapshots verifiable. Revocation (the
usual reason being suspected compromise) makes a key's snapshots fail
verification, which is why rotation revokes the outgoing key by default.

## CLI

```bash
npm run key                 # show the current key id and revocation list
npm run key -- rotate       # new key; revoke and retire the outgoing one
npm run key -- revoke <id>  # revoke a specific key
```

`recordKeySeen()` maintains an append-only local `.tokens-cache/key-history.json`
so `firstSeen` dates are stable across runs; the published file is built from it
plus the current key and the revocation list.

## Honest limitation

The key-history and revocation files are served from the same origin as the
snapshots. An attacker holding both a key **and** the deploy pipeline could
suppress a revocation. Closing that gap needs a third-party revocation registry —
it is not built. Until then, treat same-origin revocation as best-effort.

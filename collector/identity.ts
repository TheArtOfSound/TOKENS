/**
 * Identity proof CLI.
 *
 *   npm run identity -- --github <your-github-login>
 *
 * Produces a statement signed by your TOKENS device key that says "I control key
 * <keyId>". You publish it as a PUBLIC GitHub gist, then add a one-line pointer
 * to profile.json. Anyone viewing your profile then fetches that gist IN THEIR
 * BROWSER and confirms the gist's owner controls the same key that signed your
 * profile.
 *
 * What this establishes: control of the linked account is tied to your signing
 * key. What it does NOT: your legal identity, or that the account itself is
 * genuine. See the claim-authority ladder (/claims).
 *
 * Nothing here is uploaded by the collector — it only prints the proof and the
 * exact steps. Publishing the gist is a deliberate action you take yourself.
 */

import { loadOrCreateDeviceKey, buildIdentityProof, publicKeyFrom } from './lib/signing';

const argv = process.argv.slice(2);
const github = (() => {
  const i = argv.indexOf('--github');
  return i >= 0 && argv[i + 1] ? argv[i + 1].replace(/^@/, '') : null;
})();

const key = loadOrCreateDeviceKey();
const { keyId } = publicKeyFrom(key.privateKeyPem);
// Fixed issuedAt is fine; the proof is about key control, not freshness.
const proof = buildIdentityProof(key.privateKeyPem, new Date().toISOString(), github);

console.log('\n=== Your TOKENS identity proof ===');
console.log(`Signing key: ${keyId} (stored in ${key.storage})`);
if (github) console.log(`Claiming GitHub account: ${github}`);
console.log('\nStep 1 — publish this as a PUBLIC gist file named "tokens-identity.json":\n');
console.log(JSON.stringify(proof, null, 2));
console.log('\n  Fastest way (GitHub CLI):');
console.log('    printf %s \'' + JSON.stringify(proof) + "' > tokens-identity.json");
console.log('    gh gist create --public tokens-identity.json');
console.log('\nStep 2 — copy the gist id from its URL (gist.github.com/<you>/<GIST_ID>) and add to profile/profile.json:\n');
console.log('    "identityProofs": [');
console.log(`      { "type": "github", "handle": ${JSON.stringify(github ?? '<your-github-login>')}, "gistId": "<GIST_ID>" }`);
console.log('    ]');
console.log('\nStep 3 — `npm run collect` to republish. Visitors will see a "controls github.com/<you>" badge that');
console.log('their own browser verified. It proves account control tied to your key — not legal identity.\n');

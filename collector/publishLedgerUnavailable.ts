#!/usr/bin/env node
/**
 * Production guard for the not-yet-deployed managed publication API.
 *
 * The previous command defaulted to http://127.0.0.1:8787, which is only the
 * local development service and cannot add a profile to ledger.imagineqira.com.
 */

const explicitApi = process.env.PUBLISH_API_URL?.trim();

if (explicitApi) {
  console.error(
    'PUBLISH_API_URL was provided, but `npm run publish:ledger` is reserved for the production-safe flow.\n' +
      'Developers testing the local publication service should run:\n' +
      '  npm run publish:ledger:dev -- --handle YOU --email you@example.com\n',
  );
  process.exit(1);
}

console.error(
  'Managed Ledger publication is not deployed yet.\n\n' +
    'The old command attempted to contact a development server on this computer, so it could not add you to the live website.\n\n' +
    'Use the working guided flow instead:\n' +
    '  npm run join\n\n' +
    'Already measured and signed? Use:\n' +
    '  npm run list-me\n\n' +
    'Nothing was uploaded.\n',
);
process.exit(1);

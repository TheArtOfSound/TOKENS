# Test Credentials

This application (Qira Agent Usage Observatory) has **no authentication**. It is a public, read-only live telemetry dashboard.

- No login / users / passwords.
- Backend API is open (read endpoints + one ingest endpoint).
- MongoDB: local, DB_NAME=qira_observatory, collections: `snapshots` (doc _id="latest"), `history`.

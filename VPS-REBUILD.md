# Steadier VPS rebuild guide

Source version: `259796342836d629a184a7d43cb10900fb915314` (published 10 November 2026).

This archive contains the tracked source and build files at that checkpoint. It does **not** contain workspace records, database contents, credentials, or Git history. Keep your current live service and backups until you have tested any VPS migration.

## Important portability limitation

The app is buildable with the included Dockerfile, but it is not a drop-in, platform-independent self-hosted release. Authentication is wired to Manus OAuth and project session signing; database access needs a MySQL-compatible database; several optional features use Manus API services for storage, mapping, voice transcription and AI. The current production workspace stays on its existing managed database and is **not** transferred by copying this source.

A VPS installation needs the legitimate, authorized platform configuration below or code changes to replace the Manus-specific OAuth, API/storage and any needed integrations with services you operate. Do not invent credentials, expose secrets in the browser, or point a new installation at the live production database without a tested migration and backup plan.

## Build

Requirements: Linux VPS with Docker Engine/BuildKit and Docker Compose (or an equivalent container runner), outbound HTTPS access, a persistent MySQL-compatible database, a DNS name with HTTPS termination, and enough disk space for the Node build and database backups.

From the extracted `steadier/` directory:

```bash
docker build -t steadier:2597963 .
```

The Dockerfile uses Node 22, installs the pinned pnpm 10.18.0 dependency tree, builds the client/server, and starts `node dist/index.js` on port 3000. The server defaults to port 3000 and honors `PORT`.

## Required runtime configuration

Keep these values in a root-readable server-side environment file such as `/etc/steadier/steadier.env`; never commit it or place server secrets in client configuration.

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://steadier:REPLACE_ME@mysql-host:3306/steadier
MANUS_PROJECT_ID=REPLACE_WITH_AUTHORIZED_PROJECT_ID
MANUS_JWT_SECRET=REPLACE_WITH_PRIVATE_RANDOM_SESSION_SECRET
MANUS_OAUTH_API_URL=REPLACE_WITH_AUTHORIZED_MANUS_OAUTH_API_URL
MANUS_OAUTH_PORTAL_URL=REPLACE_WITH_AUTHORIZED_MANUS_OAUTH_PORTAL_URL
MANUS_API_URL=REPLACE_WITH_AUTHORIZED_MANUS_API_URL
MANUS_API_KEY=REPLACE_WITH_PRIVATE_SERVER_API_KEY
MANUS_API_BROWSER_KEY=REPLACE_WITH_AUTHORIZED_BROWSER_KEY
OWNER_OPEN_ID=OPTIONAL_LEGACY_OWNER_ID
```

The `MANUS_*` entries are not supplied in this archive. Obtain valid authorized values for the VPS installation or replace the relevant integrations in source. Register/configure the VPS hostname and OAuth callback (`https://YOUR_HOST/api/oauth/callback`) with the appropriate authentication provider. `OWNER_OPEN_ID` is an optional legacy role hint; it is not a replacement for authentication.

`MANUS_API_URL`/`MANUS_API_KEY` are used for several integrations (for example, maps/place search, voice transcription, AI and object storage). Features whose credentials are absent will not work. The application exposes only explicitly allowlisted browser configuration, but you must still keep private keys server-side.

## Database and run

Provision a **new** MySQL-compatible database and a restricted database user first. Then run the checked-in additive migrations with the same runtime environment, and start the container:

```bash
docker run --rm --env-file /etc/steadier/steadier.env steadier:2597963 pnpm db:migrate

docker run -d --name steadier \
  --restart unless-stopped \
  --env-file /etc/steadier/steadier.env \
  -p 127.0.0.1:3000:3000 \
  steadier:2597963
```

Put a TLS reverse proxy (for example, Caddy or Nginx) in front of `127.0.0.1:3000`; preserve secure cookies and forward the original HTTPS scheme correctly. Check `https://YOUR_HOST/api/health` after migrations. Health returns success only when the required database tables are available. Back up MySQL off the VPS and test restore before moving real use to the new instance.

## Data migration and client behavior

The code bundle contains no private records. The current Steadier account and its workspace remain on the existing managed service. If you choose to migrate, first make a full JSON backup from inside Steadier, validate it, and restore it only into the intended new installation after authentication and database setup work. Confirm the new site does not overwrite or share the original collection. Recreate calendar-feed subscriptions and verify OAuth, mobile sign-in, backups, reminders, and any integrations on the new hostname before relying on it.

The web app and the existing Android app use different configured origins unless you change the app configuration; this source export does not change or rebuild the Android wrapper. In-app spoken check-ins require Steadier to be open and browser/WebView speech support. Calendar-feed alerts depend on a valid subscription and the calendar client's notification settings.

## Local verification

The repository README lists the available checks. Typical build/test commands are:

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

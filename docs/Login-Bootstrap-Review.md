# Login Bootstrap Review

**Scope reviewed:** `client/index.html`, emitted `dist/public/index.html`, `client/src/const.ts`, `client/public/sw.js`, `client/src/components/steadier/ClaudeConsent.tsx`, `server/_core/publicConfig.ts`, `server/_core/oauth.ts`, and `vite.config.ts`; supporting route/state/voice code was inspected as needed. This was a read-only source and artifact review. No browser, database, user-data, or live sign-in interaction was performed.

## Result

No concrete issue found in the requested scope; no application correction is recommended.

- **Bootstrap ordering:** The emitted production HTML retains the classic `/api/platform/config.js` script in the head immediately before Vite’s module script. It therefore defines `window.__MANUS_CONFIG__` synchronously before React/login code can execute. The production Express route is registered ahead of static serving and sends this configuration with `Cache-Control: no-store`.
- **Public configuration boundary:** `publicPlatformConfig()` uses an explicit four-value allowlist: project ID, OAuth portal URL, API URL, and the explicitly browser-facing API key. It does not serialize `process.env`; server credentials such as `MANUS_API_KEY`, `MANUS_JWT_SECRET`, and `DATABASE_URL` are excluded. Script serialization escapes `<`.
- **Login, CSRF, and redirect bounds:** `startLogin()` fails closed when either required login value is absent, creates a fresh nonce, writes the host-only secure state cookie, and immediately navigates with the matching state. The callback requires the nonce match before token exchange, clears it, and returns only to `/` or a validated in-app `/?compass_oauth=<opaque-ticket>` path. The consent UI independently verifies an HTTPS redirect against the server-supplied requested origin before following it.
- **Offline/cache behavior:** The v4 worker does not inspect, cache, or replay `/api/*`, Manus runtime calls, or consent-ticket navigations. Thus offline shell use cannot provide stale runtime sign-in configuration; a sign-in attempt without freshly loaded configuration displays the clear reload/online error rather than guessing or using cached credentials.
- **Consent and voice:** The signed-out permission view exposes explicit opt-in **Sign in with Manus**, **Read sign-in help aloud**, and **Stop reading** controls. Its voice hook does not initialize recognition or speech on mount; recognition and read-aloud begin only from an explicit user-triggered function. The consent flow stops reading before a decision and contains no automatic listening.

## Checks completed

- Confirmed emitted HTML order: configuration script precedes the Vite module script.
- Confirmed emitted configuration has only the allowlisted field shape (values not recorded in this review).
- Ran `npm run check` successfully.
- Ran `npx vitest run server/platform.test.ts` successfully: 5/5 tests passed.
- Ran `git diff --check` for the reviewed changes successfully.

## Targeted browser evidence

Thirteen fresh-browser checks pass against built production assets plus the real local runtime configuration endpoint. The browser is routed under the actual HTTPS frontend origin, while portal navigation is intercepted before any real sign-in. Configuration is present, signed-out voice help starts only on explicit request and stops, one click preserves the correct callback and matching host-only nonce/consent return cookies, and missing configuration fails closed without navigation. No user credentials, task records, consent grants or real logins are submitted or recorded. Publication and the user completing their own sign-in remain separate from these checks.

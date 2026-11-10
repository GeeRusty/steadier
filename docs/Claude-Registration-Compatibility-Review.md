# Claude registration compatibility review

**Recommendation:** Make one bounded Dynamic Client Registration (DCR) compatibility change: accept a `grant_types` array that contains `authorization_code` and, optionally, `refresh_token`; register and return only `grant_types: ["authorization_code"]`. Also treat an omitted `client_name` as the neutral stored/displayed value `Unnamed OAuth client`. Do not implement, issue, accept at `/token`, or advertise refresh tokens. Keep every other current validation and the owner-consent flow unchanged.

## What is known and what is not

The current validator rejects `client_name` when absent and accepts `grant_types` only when it is exactly `["authorization_code"]` (`server/steadier/compassOAuth.ts:304-333`). Its registration response and discovery metadata already advertise only authorization-code support, and `/token` accepts only `grant_type=authorization_code` (`compassOAuth.ts:474-496,535-545,594-601`). The existing focused test sends the same strict, one-element grant array (`compassOAuth.test.ts:317-331`).

RFC 7591 makes `client_name` optional, recommends that clients send it, and explicitly allows an authorization server to substitute valid metadata values for requested ones. It also defines `refresh_token` as a grant-type value, says omitted `grant_types` defaults to authorization code, and explains that authorization-code registration corresponds to response type `code`. Therefore, registering the accepted server policy rather than echoing a broader requested set is standard DCR behavior. [1]

Current Claude connector documentation confirms that **Register automatically** uses DCR and that DCR registers Claude as a public client. Claude always uses S256 PKCE. Its published guidance says it appends `offline_access` only when that scope appears in `scopes_supported`, and that it later refreshes stored tokens. The MCP authorization specification likewise depicts a token response that may include a refresh token and says public-client refresh tokens must be rotated when issued. These sources show why an authorization-code-plus-refresh registration request is plausible and interoperable. They do **not** publish Claude’s exact DCR JSON payload, so they do not prove that this was the rejected request. [2] [3] [4]

The reported absence of actual Claude client rows means no successful call reached `createClient`; it narrows the observed failure to before or during successful DCR (or to a different deployment/persistence path). It does **not** identify the request metadata. The present “couldn’t start sign-in” error could still occur before the registration POST, at registration validation, or on another early remote flow. The exact Claude cause is therefore **unconfirmed** until privacy-safe outcome telemetry records an attempted registration and its coarse validation result.

## Minimal valid behavior

Keep the current response and advertised metadata exactly as authorization-code-only. The registration request is a request for metadata, not a promise that the server must enable every requested feature.

| Request field | Accept | Register/return | Reject |
|---|---|---|---|
| `grant_types` | Omitted; `["authorization_code"]`; either-order unique pair of `authorization_code` and `refresh_token` | `["authorization_code"]` | Empty array; refresh-only; duplicate entries; any other grant type; non-array |
| `client_name` | A current valid name; omission | Supplied valid name or `Unnamed OAuth client` | Present but invalid name |
| `response_types` | Omitted or exactly `["code"]` | `["code"]` | Any other shape/value |
| `token_endpoint_auth_method` | Omitted or `none` | `none` | Any other value |
| `scope` | Omitted or the existing sole read scope | Existing sole read scope | Every other scope, including `offline_access` |
| `redirect_uris`, PKCE, authorization/token checks, consent | Current behavior only | Current behavior only | Current unsafe or mismatched cases |

Implement the grant test as a set/subset check, not an order-sensitive two-item comparison: the array must contain `authorization_code`, may contain `refresh_token`, may contain nothing else, and must have no duplicates. A request that includes refresh is accepted as compatibility input only. Do not persist a “refresh allowed” bit, do not alter `grant_types_supported`, and do not add `offline_access` to supported scopes. The existing token parser should continue returning `invalid_grant` for `grant_type=refresh_token`.

For the name default, retain current validation when the field is present. The neutral value is a usability label for the consent screen, not a verified identity or an assertion that the connector is Claude. RFC 7591 warns that ordinary DCR metadata is self-asserted, so no supplied client name should be treated as an authentication signal. [1]

Add focused tests only for: omitted name plus the two permitted grant shapes; pair ordering; a response that remains authorization-code-only; and rejected refresh-only, duplicate, and unknown-grant arrays. Retain the existing tests for redirect, scope, public-client authentication, S256 PKCE, consent, and a rejected refresh-token exchange.

## Privacy-safe registration diagnostics

Use a single registration-only metric or structured event with no correlation identifier and only these derived enums/booleans:

- `event: "oauth_dcr_registration"`, `outcome: "accepted" | "rejected" | "server_error" | "rate_limited"`.
- `grant_types_shape: "omitted" | "authorization_code" | "authorization_code_plus_refresh" | "rejected"`.
- `client_name_state: "supplied_valid" | "defaulted" | "rejected"`.
- `response_types_state`, `auth_method_state`, `scope_state`, and `redirect_uris_state`, each limited to an accepted/omitted/rejected policy category.
- On rejection, one fixed `validation_stage` enum such as `content_type`, `body_shape`, `redirect_uris`, `grant_types`, `response_types`, `auth_method`, `scope`, or `client_name`.

Do **not** record request/response headers, request body, error object serialization, client ID, issued client ID, client name text, redirect URI or host, IP address, user/session identity, cookies, Authorization value, access or refresh token, authorization code, PKCE verifier/challenge, state, resource value, query string/value, content length, or per-request trace/correlation ID. Do not enable HTTP body/header capture in APM, request logging middleware, or exception reporting for these routes. Aggregate counters should not use labels derived from a client name, URI, address, or any other high-cardinality input.

Those prohibitions matter because DCR metadata is client-controlled and may contain identifying URLs, contact details, software statements, or malicious log content; headers and OAuth query/form values can carry reusable credentials; and an issued client ID, IP address, or trace ID can link attempts over time. The present OAuth route intentionally suppresses opaque-code and redirect-context logging in its generic error handler (`compassOAuth.ts:92-105`); diagnostics should preserve that property rather than logging caught requests or errors.

## Prohibited scope expansion

Do not advertise `refresh_token` in authorization-server metadata, return it in the registration response, accept refresh exchange requests, mint refresh credentials, add `offline_access`, loosen exact redirect matching, permit another token-endpoint authentication method, relax S256 PKCE, broaden scopes, change account/owner binding, or alter consent. Do not infer a successful Claude diagnosis from a newly accepted DCR request: only a later real connection outcome can establish that.

**References**

[1]: https://www.rfc-editor.org/rfc/rfc7591.html "RFC 7591 OAuth 2.0 Dynamic Client Registration Protocol"
[2]: https://claude.com/docs/connectors/building/authentication "Authentication for connectors"
[3]: https://claude.com/docs/connectors/custom/add-unlisted "Add a connector that is not in the directory"
[4]: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization "Model Context Protocol authorization"

## Implemented software evidence

The implementation follows the bounded grant-set and omitted-name policy. It retains code-only metadata, registration response and read scope, exact PKCE/client/redirect/resource/owner checks, and existing replay/revocation.14 targeted auth/MCP/diagnostic tests, TypeScript and production build pass. A real local request with code-plus-refresh and no name returns201, code-only registered grants, a neutral label and no token; anonymous private MCP access remains401. Logs use only fixed stage/method/content/metadata enums, booleans and status/timing; private routes and submitted values are excluded, logging is bounded, and logger failures do not change authentication. Frontend build assets are unchanged, including voice, read-aloud and refocus. The same registration shape was400 on the earlier live server. The actual rejected Claude payload remains unknown; publication and the next real attempt are required to establish whether it resolves the user error.

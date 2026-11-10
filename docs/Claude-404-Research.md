# Claude custom-connector 404: OAuth discovery compatibility

**Author:** Manus AI  
**Date:** 24 October 2026

The deployed connector’s reported first two discovery steps are correct: an unauthenticated MCP request returns `401` with a Bearer `resource_metadata` URL, and that Protected Resource Metadata document names `https://steadier-9wkmejo8.manus.space/api/compass/oauth` as its authorization-server issuer. This is the most reliable discovery route Claude documents, including when the MCP endpoint is mounted below a path. [1]

## Confirmed: the standards-required authorization metadata URL already exists

For a path-bearing issuer such as:

```text
https://steadier-9wkmejo8.manus.space/api/compass/oauth
```

RFC 8414 requires insertion of the well-known segment between the host and issuer path, not appending it to the issuer:

```text
https://steadier-9wkmejo8.manus.space/.well-known/oauth-authorization-server/api/compass/oauth
```

That endpoint reportedly returns `200`, so the required RFC 8414 discovery route is present. The current MCP discovery specification requires the same first candidate. [2] [3]

The current MCP compatibility candidates for this path issuer are, in order:

1. `/.well-known/oauth-authorization-server/api/compass/oauth` — present.
2. `/.well-known/openid-configuration/api/compass/oauth` — only tried if OAuth AS metadata discovery fails.
3. `/api/compass/oauth/.well-known/openid-configuration` — an OIDC compatibility fallback only.

There is **no standards-required append-style OAuth-AS candidate** at `/api/compass/oauth/.well-known/oauth-authorization-server`. The append rule is for the *OIDC* `openid-configuration` suffix, not `oauth-authorization-server`. [2] [3]

The official TypeScript MCP SDK implementation corroborates this order: it first constructs the RFC 8414 path-insertion OAuth URL, then its root OAuth fallback, and only then tries the two OIDC URLs. Its legacy MCP-as-authorization-server routine uses the root `/.well-known/oauth-authorization-server` URL. Both reported OAuth URLs already return `200` in this deployment. [4]

## What the reported 404 could still mean

The observation does **not** prove that the Claude custom-connector UI is failing at OAuth-AS discovery. Claude’s own docs state that it performs discovery, then must obtain a client identity by Client ID Metadata Document, Dynamic Client Registration (DCR), or a pre-registered OAuth client. A failure in any later pre-login step can still occur before the user sees the authorization page. [1] [5]

A public Claude Code bug report shows a real historical path-routing discovery defect: Claude Code 2.0.13 reportedly discarded the application path and queried only the origin-root AS metadata URL. It was closed automatically rather than fixed. This is useful evidence that path deployment issues have occurred, but it is **not confirmation** that hosted Claude custom connectors have the same implementation. It would also not explain this case if the reported root `/.well-known/oauth-authorization-server` response is valid and reachable. [6]

The missing endpoint `/api/compass/.well-known/oauth-authorization-server` is not a valid candidate for the declared issuer `/api/compass/oauth`. Serving the current document there would fail RFC 8414 issuer validation, because AS metadata must return an `issuer` value identical to the issuer from which the client derived the metadata URL. Do not add this alias as a speculative fix. [3]

## Smallest safe compatibility fix

**Do not make a broad routing change.** The primary, standards-compliant discovery endpoint is already correct.

If edge/application logs from the failing Claude attempt show a `404` specifically for:

```text
/api/compass/oauth/.well-known/oauth-authorization-server
```

then a narrowly scoped, low-risk compatibility alias is reasonable:

```text
/api/compass/oauth/.well-known/oauth-authorization-server
  -> return the same AS metadata as
     /.well-known/oauth-authorization-server/api/compass/oauth
```

The response must retain exactly this issuer:

```json
{"issuer":"https://steadier-9wkmejo8.manus.space/api/compass/oauth"}
```

This alias is for a non-standard client that appends the OAuth suffix; it is not required by MCP/RFC 8414 and should be added only when the failing request proves it is needed. It does not alter the declared issuer or OAuth endpoints, so it is substantially safer than inventing a second issuer at `/api/compass`.

If the observed 404 is instead for one of the two OIDC paths, add only the matching `openid-configuration` alias and return valid OIDC discovery metadata with the same issuer. If no AS metadata URL is requested at all, aliases cannot fix the failure; retain the server-side request log plus Claude’s `ofid_` reference and report it to Anthropic as their troubleshooting guide directs. [5]

## Checks required before the connector can reach login

These are materially relevant despite direct DCR/code/token endpoint tests succeeding:

- **Exact resource identifier:** The Protected Resource Metadata `resource` value must be exactly the URL entered into Claude, including `/api/compass/mcp`. The primary `authorization_servers` entry must be the intended issuer. [1]
- **Valid AS metadata:** At the RFC 8414 insertion URL, `issuer` must exactly equal `https://steadier-9wkmejo8.manus.space/api/compass/oauth`. Confirm its advertised `authorization_endpoint`, `token_endpoint`, supported `response_types`/grants, and registration mechanism are publicly reachable. [1] [3]
- **Correct client-registration choice:** In Claude’s add-connector UI, **Use Claude’s published identity** requires metadata to advertise both `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported` containing `none`. Otherwise select **Register automatically**, which requires a published `registration_endpoint`, or supply a pre-registered client. A working DCR endpoint is insufficient if it is omitted from metadata or Claude is configured to use published identity. [1] [5]
- **PKCE:** Claude always sends S256 PKCE. Metadata should advertise `code_challenge_methods_supported: ["S256"]`, and the authorization and token flow must accept it. [1] [5]
- **Hosted-Claude redirect:** The authorization server must allow exactly `https://claude.ai/api/mcp/auth_callback` for claude.ai, Desktop, mobile, and Cowork. This is not the same as Claude Code’s loopback redirect. [1]
- **Token resource/audience:** Claude sends the MCP URL (canonicalized, including its path) as the OAuth `resource` parameter. The issued token must be accepted as intended for that resource. This matters after login, rather than for the current 404. [5]
- **Public edge behavior:** Both MCP and AS discovery must be publicly reachable from Anthropic and must not be altered by redirects, WAF rules, or a proxy that strips `WWW-Authenticate`. [1] [5]

## Conclusion

**Confirmed:** The reported `401` challenge, PRM pointer, and path-insertion OAuth-AS metadata URL satisfy the discovery mechanism Claude and MCP specify. The absence of append-style OAuth-AS metadata is not a standards defect. The root OAuth-AS metadata also covers the legacy SDK fallback.

**Plausible but unconfirmed:** A hosted Claude implementation may be probing a non-standard URL, or the UI may be failing later while choosing/registering an OAuth client. The Claude Code issue is evidence that routing bugs have existed, but does not identify the hosted connector’s failing URL.

**Best next action:** Inspect the failing attempt’s public request log and Claude error’s `ofid_` value. Add only the single logged append-style OAuth alias if that exact URL receives the 404; otherwise validate the resource string, AS metadata registration fields, PKCE metadata, and hosted callback registration before changing routes.

## References

[1]: https://claude.com/docs/connectors/building/authentication "Authentication for connectors"
[2]: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization "MCP authorization specification 2025-11-25"
[3]: https://datatracker.ietf.org/doc/html/rfc8414 "RFC 8414 OAuth 2.0 Authorization Server Metadata"
[4]: https://github.com/modelcontextprotocol/typescript-sdk/blob/7065c38/src/client/auth.ts "TypeScript MCP SDK authorization discovery implementation"
[5]: https://claude.com/docs/connectors/building/troubleshooting "Troubleshoot your connector"
[6]: https://github.com/anthropics/claude-code/issues/9334 "Claude Code issue 9334 path-based OAuth discovery"

## Confirmed integration finding after research

The parent exercised strict official SDK discovery directly against the live origin fallback, not only its HTTP status. The root metadata returned the nested issuer and the SDK rejected it with IssuerMismatchError. This is a confirmed application compatibility defect, although the exact real-Claude404 path is still awaiting the user screenshot. The scoped repair gives the root document the exact public-origin issuer while preserving the canonical nested document and the same nested authorization/token/registration endpoints. No issuer-check bypass, arbitrary aliases, task change or voice change was introduced. Strict root and canonical automatic SDK discovery plus existing auth/reader guards now pass:9 targeted tests, TypeScript and production build. Publication/live confirmation remains the next release step.

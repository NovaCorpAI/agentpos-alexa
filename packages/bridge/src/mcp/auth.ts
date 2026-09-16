/**
 * Bearer verification for the MCP endpoint. Today a static token from the environment
 * (BRIDGE_BEARER_TOKEN); the OAuth 2.0 client credentials issuer lands with the checkout
 * module (#7) and plugs into the same OAuthTokenVerifier interface.
 */
import { timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, requireBearerAuth, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";

export function staticTokenVerifier(expected: string, clientId = "static-token"): OAuthTokenVerifier {
  const expectedBuf = Buffer.from(expected);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const given = Buffer.from(token);
      const ok = given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
      if (!ok) throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown bearer token");
      return { token, clientId, scopes: ["mcp"], expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    },
  };
}

/** A fetch-style gate: resolves to AuthInfo, or to the 401/403 Response to return as is. */
export function bearerGate(verifier: OAuthTokenVerifier): (req: Request) => Promise<AuthInfo | Response> {
  return requireBearerAuth({ verifier, requiredScopes: ["mcp"] });
}

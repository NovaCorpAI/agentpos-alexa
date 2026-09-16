/**
 * OAuth 2.0 for platforms: client_credentials at POST /oauth/token, opaque bearer tokens
 * stored hashed with a one hour life. Account linking for households (authorization code
 * with PKCE, which Alexa+ requires for stored payment methods) is a follow-up; the verifier
 * below accepts tokens from both this issuer and the static environment token.
 */
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { OAuthRepo } from "../storage/checkout-store.js";

export const TOKEN_TTL_SECONDS = 3600;
export const SCOPES = ["mcp", "checkout"];

export function storedTokenVerifier(repo: OAuthRepo): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const found = repo.lookupToken(token);
      if (!found) throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown bearer token");
      if (found.expiresAt <= Math.floor(Date.now() / 1000)) throw new OAuthError(OAuthErrorCode.InvalidToken, "Token expired");
      return { token, clientId: found.clientId, scopes: found.scopes, expiresAt: found.expiresAt };
    },
  };
}

export function staticTokenVerifier(expected: string, clientId = "static-token"): OAuthTokenVerifier {
  const expectedBuf = Buffer.from(expected);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const given = Buffer.from(token);
      const ok = given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
      if (!ok) throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown bearer token");
      return { token, clientId, scopes: SCOPES, expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
    },
  };
}

/** Tries each verifier in order; the first that accepts wins. */
export function anyOf(...verifiers: OAuthTokenVerifier[]): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let last: unknown;
      for (const v of verifiers) {
        try {
          return await v.verifyAccessToken(token);
        } catch (e) {
          last = e;
        }
      }
      throw last ?? new OAuthError(OAuthErrorCode.InvalidToken, "Unknown bearer token");
    },
  };
}

function parseBasic(header: string | undefined): { id: string; secret: string } | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return undefined;
  return { id: decodeURIComponent(decoded.slice(0, idx)), secret: decodeURIComponent(decoded.slice(idx + 1)) };
}

/** RFC 6749 section 4.4 token endpoint, client_secret_basic or client_secret_post. */
export async function tokenEndpoint(c: Context, repo: OAuthRepo): Promise<Response> {
  const contentType = c.req.header("content-type") ?? "";
  let form: Record<string, string> = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    form = Object.fromEntries(new URLSearchParams(await c.req.text()));
  } else if (contentType.includes("application/json")) {
    form = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  }
  const basic = parseBasic(c.req.header("authorization"));
  const clientId = basic?.id ?? form.client_id;
  const secret = basic?.secret ?? form.client_secret;
  c.header("Cache-Control", "no-store");
  if (form.grant_type !== "client_credentials") {
    return c.json({ error: "unsupported_grant_type", error_description: "Only client_credentials is supported here" }, 400);
  }
  if (!clientId || !secret || !repo.verifyClient(clientId, secret)) {
    c.header("WWW-Authenticate", 'Basic realm="agentpos-alexa"');
    return c.json({ error: "invalid_client", error_description: "Unknown client or secret" }, 401);
  }
  const requested = (form.scope ?? SCOPES.join(" ")).split(" ").filter(Boolean);
  if (requested.some((s) => !SCOPES.includes(s))) {
    return c.json({ error: "invalid_scope", error_description: `Allowed scopes: ${SCOPES.join(" ")}` }, 400);
  }
  const { token } = repo.issueToken(clientId, requested, TOKEN_TTL_SECONDS);
  return c.json({ access_token: token, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: requested.join(" ") });
}

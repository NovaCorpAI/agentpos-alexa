import { describe, expect, it } from "vitest";
import { StoreDiscoveryError, discoverStore, parseStoreProfile, storeOrigin } from "./index.js";

const profile = {
  ucp: {
    version: "2026-08-25",
    services: {
      "com.novacorplabs.agentpos": [
        { version: "2026-08-25", transport: "rest", endpoint: "https://shop.example/agentpos" },
        { version: "2026-08-25", transport: "mcp", endpoint: "https://shop.example/agentpos/mcp" },
      ],
    },
    capabilities: {},
    payment_handlers: {
      "org.x402.stellar": [{ id: "x402-stellar", version: "2026-08-25" }],
    },
  },
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof StoreDiscoveryError) return e.code;
    throw e;
  }
  throw new Error("expected a StoreDiscoveryError");
}

describe("parseStoreProfile", () => {
  it("extracts rest, mcp, payment handlers and keeps the raw profile", () => {
    const s = parseStoreProfile("https://shop.example", profile);
    expect(s.restBase).toBe("https://shop.example/agentpos");
    expect(s.mcpEndpoint).toBe("https://shop.example/agentpos/mcp");
    expect(s.paymentHandlers).toEqual(["x402-stellar"]);
    expect(s.ucpVersion).toBe("2026-08-25");
    expect(s.profile).toBe(profile);
  });

  it("rejects a document that is not a UCP profile with a typed error", () => {
    expect(codeOf(() => parseStoreProfile("https://x.example", { hello: 1 }))).toBe(
      "STORE_PROFILE_INVALID",
    );
  });

  it("rejects a UCP store that does not run AgentPOS", () => {
    expect(
      codeOf(() =>
        parseStoreProfile("https://x.example", { ucp: { version: "2026-04-08", services: {} } }),
      ),
    ).toBe("STORE_NOT_AGENTPOS");
  });
});

describe("storeOrigin", () => {
  it("reduces any page URL to the origin", () => {
    expect(storeOrigin("https://shop.example/some/page?x=1")).toBe("https://shop.example");
  });

  it("rejects a non-URL and a non-http scheme with a typed error", () => {
    expect(codeOf(() => storeOrigin("not a url"))).toBe("STORE_URL_INVALID");
    expect(codeOf(() => storeOrigin("ftp://shop.example"))).toBe("STORE_URL_INVALID");
  });
});

describe("discoverStore", () => {
  it("fetches /.well-known/ucp from the origin only", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const s = await discoverStore("https://shop.example/some/page?x=1", fakeFetch);
    expect(calls).toEqual(["https://shop.example/.well-known/ucp"]);
    expect(s.origin).toBe("https://shop.example");
  });

  it("maps a 404 to STORE_NOT_AGENTPOS", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(discoverStore("https://shop.example", fakeFetch)).rejects.toMatchObject({
      code: "STORE_NOT_AGENTPOS",
    });
  });

  it("maps a non-JSON body to STORE_PROFILE_INVALID", async () => {
    const fakeFetch = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    await expect(discoverStore("https://shop.example", fakeFetch)).rejects.toMatchObject({
      code: "STORE_PROFILE_INVALID",
    });
  });

  it("maps a network failure to STORE_UNREACHABLE", async () => {
    const fakeFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(discoverStore("https://shop.example", fakeFetch)).rejects.toMatchObject({
      code: "STORE_UNREACHABLE",
    });
  });
});

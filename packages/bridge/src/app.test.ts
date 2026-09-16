import { parseStoreProfile } from "@agentpos-alexa/store-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, TRACE_HEADER } from "./app.js";
import { createLogger, memorySink } from "./logging.js";
import { BRIDGE_VENDOR_KEY } from "./profile/serve.js";
import { openStorage, type Storage } from "./storage/sqlite.js";
import { slugFromOrigin } from "./storage/store-registry.js";

const bakeryProfile = {
  ucp: {
    version: "2026-08-25",
    services: {
      "com.novacorplabs.agentpos": [
        { version: "2026-08-25", transport: "rest", endpoint: "https://bakery.example/agentpos" },
        { version: "2026-08-25", transport: "mcp", endpoint: "https://bakery.example/agentpos/mcp" },
      ],
    },
    capabilities: {},
    payment_handlers: {
      "org.x402.stellar": [{ id: "x402-stellar", version: "2026-08-25" }],
    },
  },
};

describe("Bridge app", () => {
  let storage: Storage;
  let logs: ReturnType<typeof memorySink>;

  beforeEach(() => {
    storage = openStorage({ path: ":memory:" });
    logs = memorySink();
  });
  afterEach(() => storage.close());

  function app() {
    return createApp({ storage, logger: createLogger(logs.sink) });
  }

  it("serves a registered Store's UCP profile under its slug, with the Bridge's vendor block", async () => {
    const store = parseStoreProfile("https://bakery.example", bakeryProfile);
    storage.stores.register(slugFromOrigin(store.origin), store);

    const res = await app().request("/stores/bakery-example/.well-known/ucp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ucp).toEqual(bakeryProfile.ucp);
    expect(body[BRIDGE_VENDOR_KEY]).toMatchObject({ slug: "bakery-example", mcp: "2025-11-25" });
  });

  it("answers an unknown slug with a typed 404", async () => {
    const res = await app().request("/stores/nope/.well-known/ucp");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
  });

  it("propagates Request-Id as the traceId into the response and the log line", async () => {
    const res = await app().request("/health", { headers: { [TRACE_HEADER]: "trace-123" } });
    expect(res.headers.get(TRACE_HEADER)).toBe("trace-123");
    expect(logs.records.at(-1)).toMatchObject({ msg: "request", traceId: "trace-123", status: 200 });
  });

  it("generates a traceId when the caller sends none", async () => {
    const res = await app().request("/health");
    expect(res.headers.get(TRACE_HEADER)).toMatch(/[0-9a-f-]{36}/);
  });

  it("lists registered Stores without any secret material", async () => {
    const store = parseStoreProfile("https://bakery.example", bakeryProfile);
    storage.stores.register("bakery", store);
    const body = (await (await app().request("/stores")).json()) as { stores: unknown[] };
    expect(body.stores).toEqual([
      {
        slug: "bakery",
        origin: "https://bakery.example",
        ucpVersion: "2026-08-25",
        paymentHandlers: ["x402-stellar"],
      },
    ]);
  });
});

describe("store registry", () => {
  it("derives slugs from origins and rejects bad ones", () => {
    expect(slugFromOrigin("https://demo.agentposhq.com")).toBe("demo-agentposhq-com");
    expect(slugFromOrigin("https://Bakery.Example:8443")).toBe("bakery-example");
    const storage = openStorage({ path: ":memory:" });
    const store = parseStoreProfile("https://bakery.example", bakeryProfile);
    expect(() => storage.stores.register("Not Valid", store)).toThrow(RangeError);
    storage.close();
  });

  it("upserts on the same slug", () => {
    const storage = openStorage({ path: ":memory:" });
    const store = parseStoreProfile("https://bakery.example", bakeryProfile);
    storage.stores.register("bakery", store);
    storage.stores.register("bakery", { ...store, ucpVersion: "2026-09-01" });
    expect(storage.stores.list()).toHaveLength(1);
    expect(storage.stores.get("bakery")?.ucpVersion).toBe("2026-09-01");
    storage.close();
  });
});

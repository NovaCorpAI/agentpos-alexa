import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createFixtureStore } from "./app.js";
import { stripeTestProcessor } from "./processor.js";

// The workspace .env fills what the environment does not set; nothing is printed.
for (let dir = process.cwd(); ; dir = dirname(dir)) {
  const file = resolve(dir, ".env");
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
  if (dirname(dir) === dir) break;
}

const port = Number(process.env.FIXTURE_STORE_PORT ?? 8790);
const baseUrl = process.env.FIXTURE_STORE_URL ?? `http://127.0.0.1:${port}`;
// The merchant's own PSP (#9): Stripe in test mode, keys held by the Store, never the Bridge.
const secret = process.env.FIXTURE_STRIPE_SECRET_KEY;
const publishable = process.env.FIXTURE_STRIPE_PUBLISHABLE_KEY ?? process.env.STRIPE_PUBLISHABLE_KEY;
const processor = secret && publishable ? stripeTestProcessor(secret, publishable) : undefined;
const { app } = createFixtureStore({ baseUrl, ...(processor ? { processor } : {}) });

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(
    JSON.stringify({ service: "fixture-store", msg: "listening", port: info.port, baseUrl, fixture: true, merchantPsp: processor ? "stripe test mode" : "not configured" }) + "\n",
  );
});

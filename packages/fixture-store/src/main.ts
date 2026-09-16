import { serve } from "@hono/node-server";
import { createFixtureStore } from "./app.js";

const port = Number(process.env.FIXTURE_STORE_PORT ?? 8790);
const baseUrl = process.env.FIXTURE_STORE_URL ?? `http://127.0.0.1:${port}`;
const { app } = createFixtureStore({ baseUrl });

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(
    JSON.stringify({ service: "fixture-store", msg: "listening", port: info.port, baseUrl, fixture: true }) + "\n",
  );
});

/**
 * Merchant-side routes: scan a Store URL, read the draft, confirm it. Bearer-gated like the
 * checkout; the Merchant console in the Simulator app is their only client today.
 */
import type { Hono } from "hono";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { BridgeError } from "../errors.js";
import type { Logger } from "../logging.js";
import type { OnboardingService } from "./service.js";

type Env = { Variables: { traceId: string; log: Logger } };

const ScanBody = z.object({
  storeUrl: z.string().url(),
  language: z.enum(["en-US", "es-CL"]).optional(),
});

const ConfirmBody = z.object({
  overlay: z.array(z.object({ itemId: z.string().min(1), spokenName: z.string().max(120).optional(), summary: z.string().max(400).optional(), synonyms: z.array(z.string().max(60)).max(10).optional() })).max(500),
  policies: z.object({ voiceIntro: z.string().max(400), deliveryNote: z.string().max(400), reviewNote: z.string().max(400) }),
});

export function registerOnboardingRoutes(app: Hono<Env>, deps: { service: OnboardingService; gate: (req: Request) => Promise<AuthInfo | Response> }): void {
  app.use("/onboarding/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const auth = await deps.gate(c.req.raw);
    if (auth instanceof Response) return auth;
    await next();
  });

  app.post("/onboarding/scan", async (c) => {
    const parsed = ScanBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new BridgeError(400, { code: "BAD_REQUEST", message: "storeUrl (http or https URL) is required", hint: "Send { storeUrl, language? }." });
    const state = await deps.service.scan(parsed.data.storeUrl, parsed.data.language ?? "en-US", c.get("traceId"), c.get("log"));
    return c.json(state, 201);
  });

  app.get("/onboarding/:slug", async (c) => c.json(await deps.service.get(c.req.param("slug"), c.get("traceId"))));

  app.post("/onboarding/:slug/confirm", async (c) => {
    const parsed = ConfirmBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new BridgeError(400, { code: "BAD_REQUEST", message: "overlay[] and policies are required", hint: "Send the draft back, edited as the Merchant wants it." });
    return c.json(await deps.service.confirm(c.req.param("slug"), parsed.data.overlay, parsed.data.policies, c.get("traceId"), c.get("log")));
  });
}

#!/usr/bin/env node
/**
 * Plays the demo end to end against a running Simulator and prints every turn: which tools it
 * called and what the assistant answered. Used to check the video's voice over against the
 * system's own words (docs/VIDEO.md) and to verify a deployment after a release.
 *
 *   node scripts/demo-run.mjs https://<simulator host>
 */
const S = (process.argv[2] ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (path, body) => { const r = await fetch(S + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return { status: r.status, ...JSON.parse(t) }; } catch { return { status: r.status, raw: t.slice(0, 200) }; } };
const { addons } = await j("/api/addons");
const addon = addons[0].slug;
const origin = addons[0].origin;
const say = async (text, scene) => { const t = await j("/api/turn", { addon, text, language: "en-US", scene }); console.log(`  > ${text} [${t.status}] ${t.toolCalls?.map((c) => c.name).join(",") ?? ""} | ${(t.speak ?? []).join(" ").slice(0, 170)} ${t.error ?? ""}`); await wait(8000); return t; };
const confirm = async (checkout, scene) => { const opt = checkout.options.find((o) => o.available); let c = await j(`/api/checkout/${checkout.sessionId}/confirm`, { handlerId: opt.handlerId, instrumentId: opt.instrumentId, scene }); if (c.checkout?.session?.messages?.some((m) => m.severity === "requires_buyer_review")) { console.log("  guardian:", c.speak?.[0]); await wait(3000); c = await j(`/api/checkout/${checkout.sessionId}/confirm`, { handlerId: opt.handlerId, instrumentId: opt.instrumentId, scene }); } console.log("  confirm:", c.speak?.[0]); await wait(5000); return c; };

console.log("Scene 5: onboarding");
await j("/api/reset", { addon });
const t0 = Date.now();
const draft = await j("/api/merchant/scan", { storeUrl: origin, language: "en-US" });
console.log(`  scan [${draft.status}] ${draft.overlay?.length} lines, model ${draft.modelUsed} in ${Date.now() - t0} ms | ${draft.policies?.voiceIntro}`);
const pub = await j(`/api/merchant/${draft.slug}/confirm`, { overlay: draft.overlay, policies: draft.policies });
console.log(`  published [${pub.status}] ${pub.status === 200 ? pub.elapsedMs?.scanToPublished + " ms after scan" : JSON.stringify(pub).slice(0, 200)}`);

console.log("Scene 1: first voice purchase");
await say("What bread do you have?", "first-voice-purchase");
const buy = await say("Buy one baguette", "first-voice-purchase");
if (buy.checkout) await confirm(buy.checkout, "first-voice-purchase");
await say("Show me the receipt", "first-voice-purchase");

console.log("Scene 2: is it gluten free?");
await say("Is the gluten free seeded loaf gluten free?", "gluten-free");
await say("Is the gluten free seeded loaf organic?", "gluten-free");

console.log("Scene 3 and 4: the same as last week, guardian asks");
await j("/api/reset", { addon });
const again = await say("The same as last week", "same-as-last-week");
if (again.checkout) await confirm(again.checkout, "same-as-last-week");

const state = await j(`/api/merchant/${draft.slug}`);
console.log("onboarding timer:", JSON.stringify(state.elapsedMs));

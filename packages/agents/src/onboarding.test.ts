import { describe, expect, it } from "vitest";
import type { CatalogFact } from "./catalog.js";
import { draftFromCatalog, OnboardingAgent, spokenName, spokenSummary, synonymsFor } from "./onboarding.js";
import { FakeModel } from "./testing/fake-model.js";

const items: CatalogFact[] = [
  { id: "sourdough-loaf", title: "Sourdough loaf", description: "Naturally leavened, 800 g, baked daily. Crisp crust.", priceDisplay: "6.5 USDC", attributes: { glutenFree: false } },
  { id: "oat-cookies-6", title: "Oat cookies, bag of 6", description: "Chewy oat cookies with dark chocolate.", priceDisplay: "4.5 USDC", attributes: { pieces: 6 } },
  { id: "gluten-free-loaf", title: "Gluten-free seeded loaf", description: "Buckwheat and sunflower loaf, 600 g, baked in a dedicated gluten-free oven.", priceDisplay: "7.8 USDC", attributes: {} },
];
const input = { storeName: "Fixture Bakery", language: "en-US" as const, items, physicalGoods: true };

describe("onboarding drafter", () => {
  it("writes pronounceable names, one-sentence summaries and simple synonyms from the catalog alone", () => {
    expect(spokenName("Oat cookies, bag of 6")).toBe("Oat cookies");
    expect(spokenName("Sourdough loaf")).toBe("Sourdough loaf");
    expect(spokenSummary("Naturally leavened, 800 g, baked daily. Crisp crust.")).toBe("Naturally leavened, baked daily.");
    expect(spokenSummary("Buckwheat and sunflower loaf, 600 g, baked in a dedicated gluten-free oven.")).toBe("Buckwheat and sunflower loaf, baked in a dedicated gluten-free oven.");
    expect(synonymsFor("Gluten-free seeded loaf")).toEqual(["gluten free seeded loaf", "loaf", "gluten-free seeded loafs"]);
    const d = draftFromCatalog(input);
    expect(d.overlay.map((o) => o.itemId)).toEqual(items.map((i) => i.id));
    expect(d.policies.deliveryNote).toMatch(/delivery address/);
    expect(d.policies.voiceIntro).toBe("Fixture Bakery sells 3 items; prices are exact and come from the store.");
    expect(d.modelUsed).toBe(false);
  });

  it("with a model, takes its wording per item, keeps the rule's line for items it skipped, and reports usage", async () => {
    const usage: unknown[] = [];
    const model = new FakeModel([
      {
        text: JSON.stringify({
          overlay: [{ itemId: "oat-cookies-6", spokenName: "Oat cookies", summary: "Chewy oat cookies with dark chocolate, six to a bag.", synonyms: ["cookies", "Oat Cookie"] }],
          policies: { voiceIntro: "Fixture Bakery bakes bread and pastries every morning.", deliveryNote: "Orders are delivered; the checkout asks for an address.", reviewNote: "The store may review an order first; nothing is charged until then." },
        }),
      },
    ]);
    const d = await new OnboardingAgent({ model, modelId: "fake.strong", onUsage: (u) => usage.push(u) }).draft(input);
    expect(d.modelUsed).toBe(true);
    expect(d.overlay.find((o) => o.itemId === "oat-cookies-6")).toEqual({ itemId: "oat-cookies-6", spokenName: "Oat cookies", summary: "Chewy oat cookies with dark chocolate, six to a bag.", synonyms: ["cookies", "oat cookie"] });
    expect(d.overlay.find((o) => o.itemId === "sourdough-loaf")?.summary).toBe("Naturally leavened, baked daily.");
    expect(d.policies.voiceIntro).toMatch(/every morning/);
    expect(usage).toHaveLength(1);
    expect(model.calls[0]!.options!.systemPrompt).toMatch(/human merchant will review/);
  });

  it("falls back to the rule when the model answers nonsense, and says why", async () => {
    const d = await new OnboardingAgent({ model: new FakeModel([{ text: "nope" }]), modelId: "fake.strong" }).draft(input);
    expect(d.modelUsed).toBe(false);
    expect(d.fallbackReason).toMatch(/unparseable/);
  });
});

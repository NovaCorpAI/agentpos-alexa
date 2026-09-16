import { describe, expect, it } from "vitest";
import { answerFromFacts, CatalogAgent, matchItems, type CatalogFact } from "./catalog.js";
import { FakeModel } from "./testing/fake-model.js";

const items: CatalogFact[] = [
  { id: "sourdough-loaf", title: "Sourdough loaf", description: "Naturally leavened, 800 g.", priceDisplay: "6.5 USDC", attributes: { glutenFree: false, allergens: ["gluten"], ingredients: ["wheat flour", "water", "salt"], weightGrams: 800 } },
  { id: "gluten-free-loaf", title: "Gluten-free seeded loaf", description: "Buckwheat and sunflower loaf, 600 g, baked in a dedicated gluten-free oven.", priceDisplay: "7.8 USDC", attributes: { glutenFree: true, allergens: ["sesame", "sunflower"], ingredients: ["buckwheat flour", "sunflower seeds", "sesame"], weightGrams: 600 } },
  { id: "oat-cookies-6", title: "Oat cookies, bag of 6", description: "Chewy oat cookies.", priceDisplay: "4.5 USDC", attributes: { pieces: 6, allergens: ["gluten", "milk"] } },
];
const base = { language: "en-US" as const, storeName: "Fixture Bakery", items };

describe("catalog facts", () => {
  it("matches the item named in the question, best overlap first, synonyms from the overlay", () => {
    expect(matchItems("Is the seeded loaf gluten free?", items).map((i) => i.id)).toEqual(["gluten-free-loaf"]);
    expect(matchItems("How many cookies come in the bag?", items).map((i) => i.id)).toEqual(["oat-cookies-6"]);
    expect(matchItems("Is it organic?", items)).toEqual([]);
    expect(matchItems("Is the masa madre gluten free?", items, [{ itemId: "sourdough-loaf", synonyms: ["masa madre"] }]).map((i) => i.id)).toEqual(["sourdough-loaf"]);
  });

  it("answers gluten, allergens, ingredients, weight and pieces from the published attributes", () => {
    expect(answerFromFacts({ ...base, question: "Is the seeded loaf gluten free?" })).toMatchObject({ answer: "Yes, Gluten-free seeded loaf is gluten free.", grounded: true, itemIds: ["gluten-free-loaf"] });
    expect(answerFromFacts({ ...base, question: "Is the sourdough loaf gluten free?" })).toMatchObject({ answer: "No, Sourdough loaf contains gluten.", grounded: true });
    expect(answerFromFacts({ ...base, question: "Does the seeded loaf contain nuts?" }).answer).toBe("The listed allergens of Gluten-free seeded loaf are sesame and sunflower; nuts are not among them.");
    expect(answerFromFacts({ ...base, question: "Does the seeded loaf contain sesame?" }).answer).toMatch(/^Yes, Gluten-free seeded loaf contains sesame\./);
    expect(answerFromFacts({ ...base, question: "What is the sourdough loaf made of?" }).answer).toBe("Sourdough loaf is made with wheat flour, water and salt.");
    expect(answerFromFacts({ ...base, question: "How much does the sourdough loaf weigh?" }).answer).toBe("Sourdough loaf weighs 800 grams.");
    expect(answerFromFacts({ ...base, question: "How many cookies are in the bag?" }).answer).toBe("Oat cookies, bag of 6 comes with 6 pieces.");
  });

  it("says not published when the fact is missing, and asks which item when none is named", () => {
    const organic = answerFromFacts({ ...base, question: "Is the seeded loaf organic?" });
    expect(organic).toMatchObject({ grounded: false, itemIds: ["gluten-free-loaf"] });
    expect(organic.answer).toMatch(/^The store has not published whether it is organic for Gluten-free seeded loaf\./);
    const none = answerFromFacts({ ...base, question: "Is it organic?" });
    expect(none).toMatchObject({ grounded: false, itemIds: [] });
    expect(none.answer).toMatch(/^Which item do you mean\? Fixture Bakery sells /);
    expect(answerFromFacts({ ...base, language: "es-CL", question: "¿El pan de masa madre sourdough es libre de gluten?" }).answer).toBe("No, Sourdough loaf contiene gluten.");
  });

  it("falls back to the description and the price when no aspect is asked", () => {
    expect(answerFromFacts({ ...base, question: "Tell me about the seeded loaf" })).toMatchObject({ answer: "Gluten-free seeded loaf, 7.8 USDC. Buckwheat and sunflower loaf, 600 g, baked in a dedicated gluten-free oven.", grounded: true });
  });
});

describe("CatalogAgent", () => {
  it("without a model, the facts answer", async () => {
    const a = await new CatalogAgent().answer({ ...base, question: "Is the seeded loaf gluten free?" });
    expect(a).toMatchObject({ grounded: true, modelUsed: false });
  });

  it("with a model, takes its wording, keeps ids to the input and never upgrades grounded", async () => {
    const usage: unknown[] = [];
    const model = new FakeModel([
      { text: JSON.stringify({ answer: "Yes, the seeded loaf is gluten free and baked in a dedicated oven.", grounded: true, itemIds: ["gluten-free-loaf", "made-up"] }) },
      { text: JSON.stringify({ answer: "It is organic.", grounded: true, itemIds: ["gluten-free-loaf"] }) },
    ]);
    const agent = new CatalogAgent({ model, modelId: "fake.fast", onUsage: (u) => usage.push(u) });
    const ok = await agent.answer({ ...base, question: "Is the seeded loaf gluten free?" });
    expect(ok).toMatchObject({ answer: "Yes, the seeded loaf is gluten free and baked in a dedicated oven.", grounded: true, itemIds: ["gluten-free-loaf"], modelUsed: true });
    expect(usage).toHaveLength(1);
    expect(model.calls[0]!.options!.systemPrompt).toMatch(/has not published/);
    const invented = await agent.answer({ ...base, question: "Is the seeded loaf organic?" });
    expect(invented.grounded).toBe(false);
  });

  it("falls back to the facts when the model answers nonsense", async () => {
    const a = await new CatalogAgent({ model: new FakeModel([{ text: "no json here" }]), modelId: "fake.fast" }).answer({ ...base, question: "Is the seeded loaf gluten free?" });
    expect(a).toMatchObject({ answer: "Yes, Gluten-free seeded loaf is gluten free.", modelUsed: false });
    expect(a.fallbackReason).toMatch(/unparseable/);
  });
});

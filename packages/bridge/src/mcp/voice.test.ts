import type { CatalogItem } from "@agentpos-alexa/store-client";
import { describe, expect, it } from "vitest";
import { speakItemDetail, speakPrice, speakQuote, speakSearch } from "./voice.js";

const item = (id: string, title: string, minor: string, attributes: Record<string, unknown> = {}): CatalogItem => ({
  id,
  type: "product",
  title,
  description: `${title} description.`,
  url: `https://bakery.example/${id}`,
  attributes,
  price: { amount: "0", asset: "USDC", minor },
  physical: true,
});

describe("voice text", () => {
  it("speaks minor units as short decimals", () => {
    expect(speakPrice("65000000", "USDC")).toBe("6.5 USDC");
    expect(speakPrice("10000000", "USDC")).toBe("1 USDC");
    expect(speakPrice("1234567", "USDC")).toBe("0.12 USDC");
    expect(speakPrice("5", "USDC")).toBe("0 USDC");
  });

  it("summarizes a search with a count and the first three items", () => {
    const items = [item("a", "Sourdough loaf", "65000000"), item("b", "Baguette", "28000000"), item("c", "Rye", "72000000"), item("d", "Focaccia", "55000000")];
    expect(speakSearch(items, "bread")).toBe(
      "For bread, I found 4 items: Sourdough loaf, 6.5 USDC; Baguette, 2.8 USDC; Rye, 7.2 USDC, and 1 more.",
    );
    expect(speakSearch([], "cake")).toBe("I did not find anything for cake.");
    expect(speakSearch([items[0]!], undefined)).toBe("I found one item: Sourdough loaf, 6.5 USDC.");
  });

  it("states the gluten fact only when the catalog publishes it", () => {
    expect(speakItemDetail(item("gf", "Seeded loaf", "78000000", { glutenFree: true }))).toContain("It is gluten free.");
    expect(speakItemDetail(item("sd", "Sourdough", "65000000", { glutenFree: false }))).toContain("It contains gluten.");
    expect(speakItemDetail(item("x", "Mystery", "1"))).not.toMatch(/gluten/);
  });

  it("speaks a quote", () => {
    expect(
      speakQuote(
        [{ itemId: "a", title: "Sourdough loaf", quantity: 2, unitPriceUsdc: "65000000", lineTotalUsdc: "130000000", physical: true, unitPrice: "6.5", lineTotal: "13" }],
        "130000000",
        "USDC",
      ),
    ).toBe("2 Sourdough loaf. Total 13 USDC.");
  });
});

describe("order and receipt voice", () => {
  it("speaks status, lines, total and the simulated label", async () => {
    const { speakOrder, speakReceipt } = await import("./voice.js");
    expect(speakOrder({ orderId: "ord_1", externalOrderId: "1001", status: "paid" }, [{ title: "Baguette", quantity: 2 }], "56000000", "USDC", true)).toBe(
      "Order 1001 is paid: 2 Baguette. Total 5.6 USDC. This was a simulated payment: no money moved.",
    );
    expect(speakReceipt({ valid: true, mode: "fixture" }, "simulated:amazon:sim_ch_1", 1)).toContain("fixture receipt, unsigned");
    expect(speakReceipt({ valid: true }, undefined, 2)).toBe("The store's signed receipt checks out. 2 receipts on record.");
  });
});

describe("no-match voice", () => {
  it("is honest about the miss and names what the store sells", async () => {
    const { speakNoMatch } = await import("./voice.js");
    expect(speakNoMatch([item("a", "Sourdough loaf", "65000000"), item("b", "Baguette", "28000000")], "bread")).toBe(
      "I did not find anything for bread. The store sells Sourdough loaf, 6.5 USDC; Baguette, 2.8 USDC.",
    );
    expect(speakNoMatch([], "cake")).toBe("I did not find anything for cake, and the catalog is empty.");
  });
});

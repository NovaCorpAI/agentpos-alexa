/**
 * The fixture bakery: physical goods with the AgentPOS catalog shape. English titles because
 * the Scenes are in English; attributes carry what the catalog agent may answer from
 * (allergens, gluten free, ingredients) and nothing it may invent.
 *
 * Prices are USDC in minor units (7 decimals): "35000000" is 3.5 USDC.
 */
import type { CatalogItem } from "@agentpos-alexa/store-client";

export const BAKERY_NAME = "Sourdough & Co. Bakery";

/** Fixture-only Stellar testnet address. Nothing is ever paid to it. */
export const BAKERY_PAY_TO = "GFIXTURE7BAKERY4TESTNET2ONLY6NOTHING5IS3EVER2PAID7HERE4AB";
export const BAKERY_NETWORK = "stellar:testnet";
export const BAKERY_ASSET = "USDC";
/** Testnet USDC issuer contract placeholder; the real one is configured in the docker Store. */
export const BAKERY_ASSET_ADDRESS = "CFIXTURE6USDC3TESTNET2CONTRACT7PLACEHOLDER4NOT5REAL6ABCD";

function item(
  id: string,
  title: string,
  description: string,
  minor: string,
  attributes: Record<string, unknown>,
  sku: string,
): CatalogItem {
  const amount = (Number(minor) / 10_000_000).toString();
  return {
    id,
    type: "product",
    title,
    description,
    url: `https://bakery.example/product/${id}/`,
    imageUrl: `https://bakery.example/images/${id}.png`,
    attributes: { sku, ...attributes },
    price: { amount, asset: BAKERY_ASSET, minor },
    physical: true,
    stockMode: "untracked",
  };
}

export const BAKERY_ITEMS: CatalogItem[] = [
  item("sourdough-loaf", "Sourdough loaf", "Naturally leavened country loaf, 800 g, crusty and open crumb.", "65000000",
    { glutenFree: false, allergens: ["gluten"], ingredients: ["wheat flour", "water", "salt", "sourdough starter"], weightGrams: 800 }, "BRD-SD-800"),
  item("baguette", "Baguette", "Classic French baguette, 250 g, baked twice daily.", "28000000",
    { glutenFree: false, allergens: ["gluten"], ingredients: ["wheat flour", "water", "salt", "yeast"], weightGrams: 250 }, "BRD-BAG-250"),
  item("gluten-free-loaf", "Gluten-free seeded loaf", "Buckwheat and sunflower loaf, 600 g, baked in a dedicated gluten-free oven.", "78000000",
    { glutenFree: true, allergens: ["sesame", "sunflower"], ingredients: ["buckwheat flour", "sunflower seeds", "sesame", "psyllium", "water", "salt"], weightGrams: 600 }, "BRD-GF-600"),
  item("butter-croissant", "Butter croissant", "Laminated with cultured butter, 80 g.", "22000000",
    { glutenFree: false, allergens: ["gluten", "milk", "egg"], ingredients: ["wheat flour", "butter", "milk", "egg", "sugar", "yeast", "salt"], weightGrams: 80 }, "PST-CRO-80"),
  item("cinnamon-rolls-4", "Cinnamon rolls, box of 4", "Soft rolls with cinnamon sugar and cream cheese glaze.", "98000000",
    { glutenFree: false, allergens: ["gluten", "milk", "egg"], ingredients: ["wheat flour", "butter", "milk", "egg", "sugar", "cinnamon", "cream cheese"], pieces: 4 }, "PST-CIN-4"),
  item("rye-loaf", "Dark rye loaf", "100 percent rye, 900 g, dense and slightly sweet.", "72000000",
    { glutenFree: false, allergens: ["gluten"], ingredients: ["rye flour", "water", "salt", "rye starter", "molasses"], weightGrams: 900 }, "BRD-RYE-900"),
  item("oat-cookies-6", "Oat cookies, bag of 6", "Chewy oat cookies with dark chocolate.", "45000000",
    { glutenFree: false, allergens: ["gluten", "milk"], ingredients: ["oats", "wheat flour", "butter", "sugar", "dark chocolate"], pieces: 6 }, "PST-OAT-6"),
  item("focaccia", "Rosemary focaccia", "Olive oil focaccia with rosemary and sea salt, 500 g.", "55000000",
    { glutenFree: false, allergens: ["gluten"], ingredients: ["wheat flour", "olive oil", "rosemary", "sea salt", "water", "yeast"], weightGrams: 500 }, "BRD-FOC-500"),
];

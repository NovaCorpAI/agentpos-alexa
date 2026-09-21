/**
 * The handful of fixed words the views own. Everything else on screen came from the store
 * in the tool result, so it is already in the store's own language; these are the labels the
 * host would expect in the customer's locale, which the host tells us in its context.
 */
export type ViewLang = "en" | "es";

export const langOf = (locale: string | undefined): ViewLang => (locale?.toLowerCase().startsWith("es") ? "es" : "en");

const EN = {
  loadingItems: "Loading items",
  loadingItem: "Loading item",
  loadingOrder: "Loading order",
  loadingReceipt: "Loading receipt",
  storeSilent: "The store could not answer right now.",
  nothingFound: "Nothing found",
  nothingFoundFor: 'Nothing found for "{query}"',
  notInCatalog: "That item is not in the catalog.",
  noOrder: "No order to show yet.",
  noReceipt: "No receipt for that order yet.",
  item: "item",
  items: "items",
  glutenFree: "Gluten free",
  containsGluten: "Contains gluten",
  delivered: "Delivered",
  digital: "Digital",
  allergens: "Allergens",
  ingredients: "Ingredients",
  weight: "Weight",
  pieces: "Pieces",
  buyThis: "Buy this",
  showReceipt: "Show receipt",
  total: "Total",
  paidWith: "Paid with",
  simulated: "SIMULATED",
  simulatedPayment: "SIMULATED payment, no money moved",
  testModeBadge: "Test mode",
  orderNotFound: "I could not find that order.",
  order: "Order",
  receiptFor: "Receipt for",
  verified: "Verified: signed by the store",
  signedBy: "signed by {signer}",
  theStore: "the store",
  unsignedLine: "unsigned",
  unsigned: "Fixture receipt, unsigned",
  unverified: "Signature did not check out",
  unsignedNote: "Unsigned fixture receipt. A real Store signs its receipt chain.",
  askAbout: "Tell me more about {title}",
  wantToBuy: "I want to buy {title}",
  showReceiptFor: "Show me the receipt for order {order}",
};

type Key = keyof typeof EN;

const ES: Record<Key, string> = {
  loadingItems: "Cargando productos",
  loadingItem: "Cargando el producto",
  loadingOrder: "Cargando el pedido",
  loadingReceipt: "Cargando la boleta",
  storeSilent: "La tienda no pudo responder en este momento.",
  nothingFound: "No se encontró nada",
  nothingFoundFor: 'No se encontró nada para "{query}"',
  notInCatalog: "Ese producto no está en el catálogo.",
  noOrder: "Todavía no hay un pedido que mostrar.",
  noReceipt: "Todavía no hay boleta para ese pedido.",
  item: "producto",
  items: "productos",
  glutenFree: "Sin gluten",
  containsGluten: "Contiene gluten",
  delivered: "Con entrega",
  digital: "Digital",
  allergens: "Alérgenos",
  ingredients: "Ingredientes",
  weight: "Peso",
  pieces: "Unidades",
  buyThis: "Comprar esto",
  showReceipt: "Ver la boleta",
  total: "Total",
  paidWith: "Pagado con",
  simulated: "SIMULADO",
  simulatedPayment: "Pago SIMULADO, no se movió dinero",
  testModeBadge: "Modo prueba",
  orderNotFound: "No encontré ese pedido.",
  order: "Pedido",
  receiptFor: "Boleta del pedido",
  verified: "Verificada: firmada por la tienda",
  signedBy: "firmada por {signer}",
  theStore: "la tienda",
  unsignedLine: "sin firma",
  unsigned: "Boleta de prueba, sin firma",
  unverified: "La firma no cuadra",
  unsignedNote: "Boleta de prueba sin firma. Una tienda real firma su cadena de boletas.",
  askAbout: "Cuéntame más sobre {title}",
  wantToBuy: "Quiero comprar {title}",
  showReceiptFor: "Muéstrame la boleta del pedido {order}",
};

const TABLE: Record<ViewLang, Record<Key, string>> = { en: EN, es: ES };

export function words(lang: ViewLang): (key: Key, vars?: Record<string, string | number>) => string {
  return (key, vars) => {
    const text = TABLE[lang][key] ?? EN[key];
    return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
  };
}

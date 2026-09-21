/**
 * The interface in English or Spanish, chosen by the visitor and remembered in this browser.
 * One choice drives everything: the words on screen, the language the assistant answers in,
 * the voice Polly uses, the Scenes it plays and the locale the MCP Apps views receive.
 *
 * Keys are English sentences in kebab-free camel case; the English column is the source and
 * the Spanish column is written for a Chilean household, not translated word by word.
 */
import { useCallback, useSyncExternalStore } from "react";

export type UiLang = "en" | "es";
/** What the Bridge, the agents and Polly call the same choice. */
export type TurnLang = "en-US" | "es-CL";

const KEY = "agentpos.lang";

function stored(): UiLang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "es" ? v : null;
  } catch {
    return null;
  }
}

function fromBrowser(): UiLang {
  try {
    return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

let current: UiLang = stored() ?? fromBrowser();
const listeners = new Set<() => void>();

export function setLang(lang: UiLang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // A browser that refuses storage still gets the change for this visit.
  }
  try {
    document.documentElement.lang = lang;
  } catch {
    // Not fatal: the attribute is for screen readers, not for the app.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen language, and a setter. Every component re-renders when it changes. */
export function useLang(): [UiLang, (lang: UiLang) => void] {
  const lang = useSyncExternalStore(subscribe, () => current, () => current);
  return [lang, setLang];
}

export const turnLangOf = (lang: UiLang): TurnLang => (lang === "es" ? "es-CL" : "en-US");

const EN = {
  lede: "An Echo Show, simulated. Talk to the store on the right: it answers out loud, puts a card on the screen, and takes the payment without leaving the conversation.",
  storeOnScreen: "The store on screen",
  storeHelp: "A real store, reached the way Alexa+ would reach it. Ask it anything in the box under the screen, or press the mic and speak.",
  askSomething: "Ask it something",
  watchScene: "Or watch a whole scene",
  sceneHelp: "Each one runs a real conversation against that store and marks its own checks.",
  sceneRun: "Run",
  sceneRunning: "Running",
  scenePending: "pending",
  sceneTurns: "turns",
  sceneFailed: "failed checks",
  merchantLink: "Put a store on Alexa+ yourself",
  merchantLinkRest: ", in the Merchant console. It is Scene 5, done by hand.",
  drawerScreen: "Screen, voice and device",
  drawerHood: "Under the hood",
  screenDoes: "What the screen does with an answer",
  device: "Device",
  look: "Look",
  dark: "Dark room",
  light: "Daylight",
  languageAndVoice: "Language and voice",
  speaking: "Speaking",
  muted: "Muted",
  voicePolly: "Amazon Polly is speaking the answers.",
  voiceBrowser: "Your browser is speaking the answers: Polly is not reachable from here.",
  voiceNext: "The next answer will be spoken.",
  voiceOff: "Answers are written, not spoken.",
  hoodAnswers: "Answers come from",
  hoodAgent: "a Household agent on Amazon Bedrock",
  hoodRecorded: "recorded responses, no model",
  hoodScripted: "a scripted router, no model",
  hoodRest: ". It reaches the store the way Alexa+ would: MCP for the catalogue, UCP checkout sessions for the payment.",
  hoodEndpoint: "MCP endpoint",
  hoodHandlers: "payment handlers",
  hoodNone: "none",
  eachTurn: "What each turn did",
  turnsNone: "Nothing said yet. Ask the store something and this fills in.",
  turnsTotals: "turns {turns}, tool calls {calls}, failed checks",
  firstItem: "first item",
  idleTitle: "Ask the store, out loud",
  idleHintMic: "or press the mic and speak",
  idleHintType: "type it in the box below",
  askPlaceholder: "Alexa, ask {store}...",
  noAddon: "No add-on",
  mic: "mic",
  listening: "listening",
  send: "Send",
  micUnavailable: "Speech recognition is not available in this browser",
  micSpeak: "Speak",
  wentWrong: "Something went wrong: {message}",
  scene: "Scene",
  // Checkout
  checkout: "Checkout",
  statusReady: "ready to pay",
  statusIncomplete: "not ready yet",
  statusCompleted: "paid",
  statusCanceled: "canceled",
  deliverTo: "Deliver to",
  personaNote: "Synthetic persona of the demo household",
  payWith: "Pay with",
  noPayment: "No payment method is wired in the simulator for this store yet.",
  simulated: "SIMULATED",
  testMode: "TEST MODE",
  cancel: "Cancel",
  confirm: "Confirm {total}",
  confirming: "Confirming",
  paying: "Paying",
  yesOrderAgain: "Yes, order it again",
  // The household's own history
  historyTitle: "Your purchases here",
  historySince: "since {date}",
  historyOrders: "in {orders} paid orders",
  historyNone: "Nothing paid here yet in this period.",
  historyTop: "Most bought:",
  // Playground
  playground: "Public playground",
  purchasesByVisitors: "Purchases by visitors:",
  purchasesNote: "(simulated payments, capped at $50 per order; our own Scene runs are not counted)",
  joinWaitlist: "Join the waitlist",
  roleMerchant: "I sell online and want my store on Alexa+",
  roleShopper: "I want to shop this way",
  emailPlaceholder: "you@example.com",
  storeUrlOptional: "https://your-store.example (optional)",
  consent: "Email me about AgentPOS for Alexa+. Nothing else, and I can ask to be removed.",
  join: "Join",
  joining: "Joining",
  // Merchant console
  merchantEyebrow: "merchant console",
  merchantTitle: "Put a store on Alexa+",
  merchantLede: "Four steps, about a minute. An agent reads what the store already publishes and drafts how it should sound out loud; you read every line and decide what goes live.",
  backToSimulator: "Back to the simulator",
  step1: "Point at the store",
  step1Help: "Its own address, the one customers use. The agent only reads what the store publishes, and never writes anything back to it.",
  storeAddress: "Store address",
  language: "Language",
  readAndDraft: "Read it and draft",
  reading: "Reading the store",
  readingHelp: "Reading the catalogue, then writing a spoken name, a one sentence summary and the words a household might use for each item.",
  step2: "What the agent did, timed",
  step2Earlier: "A draft left here earlier",
  draftNotLive: "draft, not live",
  published: "published",
  draftedByModel: "Drafted by the strong model on Amazon Bedrock.",
  draftedByRules: "Drafted by the deterministic drafter, with no model.",
  draftEarlierNote: " Nobody ran it in this session: read the store again to watch each stage take its time.",
  stageScan: "Scan",
  stageCatalog: "Catalog draft",
  stagePolicies: "Policies draft",
  stageConfirm: "Human confirm",
  stagePublished: "Published",
  stageFirstPurchase: "First voice purchase",
  urlToPublished: "URL to published:",
  urlToFirstPurchase: "URL to first voice purchase:",
  fromUsageEvents: "Computed from usage_events stage rows.",
  notYet: "not yet",
  staleWarning: "Changed in the Store since publication, served in the Store's own words until you confirm again:",
  step3: "Read every line before anyone hears it",
  step3Help:
    "The spoken name is what the speaker says instead of the catalogue title. The summary is the one sentence a customer hears when they ask about the item. The synonyms are the words a household might actually use for it. Change anything here: this is the draft, not the store.",
  colItem: "Item",
  colSpokenName: "Spoken name",
  colSummary: "Summary",
  colSynonyms: "Synonyms",
  policiesTitle: "What the store says about itself",
  policiesHelp: "Three sentences the assistant may repeat: how the store introduces itself, how it delivers, and what it wants a person to check before an order goes through.",
  policyIntro: "Introduction",
  policyDelivery: "Delivery",
  policyReview: "Human review",
  step4Live: "It is live",
  step4Publish: "Publish it",
  step4LiveNote: "Alexa+ now answers for this store in the words above. Go and",
  step4LiveLink: "ask it for something",
  step4LiveRest: ", or change a line and publish again.",
  step4Note: "Until you confirm, the assistant answers in the store's own catalogue words. Nothing here is live yet.",
  publishChanges: "Publish the changes",
  confirmAndPublish: "Confirm and publish",
  publishing: "Publishing",
};

type Key = keyof typeof EN;

const ES: Record<Key, string> = {
  lede: "Un Echo Show, simulado. Háblale a la tienda de la derecha: te responde en voz alta, pone una tarjeta en la pantalla y cobra sin salir de la conversación.",
  storeOnScreen: "La tienda en pantalla",
  storeHelp: "Una tienda real, alcanzada como la alcanzaría Alexa+. Pregúntale lo que quieras en la caja bajo la pantalla, o aprieta el micrófono y habla.",
  askSomething: "Pregúntale algo",
  watchScene: "O mira una escena completa",
  sceneHelp: "Cada una corre una conversación real contra esa tienda y marca sus propias comprobaciones.",
  sceneRun: "Correr",
  sceneRunning: "Corriendo",
  scenePending: "pendiente",
  sceneTurns: "turnos",
  sceneFailed: "comprobaciones fallidas",
  merchantLink: "Pon una tienda en Alexa+ tú mismo",
  merchantLinkRest: ", en la consola del comerciante. Es la escena 5, hecha a mano.",
  drawerScreen: "Pantalla, voz y dispositivo",
  drawerHood: "Por dentro",
  screenDoes: "Qué hace la pantalla con una respuesta",
  device: "Dispositivo",
  look: "Aspecto",
  dark: "Pieza oscura",
  light: "Luz de día",
  languageAndVoice: "Idioma y voz",
  speaking: "Hablando",
  muted: "En silencio",
  voicePolly: "Amazon Polly está diciendo las respuestas.",
  voiceBrowser: "Tu navegador está diciendo las respuestas: Polly no responde desde aquí.",
  voiceNext: "La próxima respuesta se dirá en voz alta.",
  voiceOff: "Las respuestas se escriben, no se dicen.",
  hoodAnswers: "Las respuestas vienen de",
  hoodAgent: "un agente del hogar en Amazon Bedrock",
  hoodRecorded: "respuestas grabadas, sin modelo",
  hoodScripted: "un enrutador con reglas, sin modelo",
  hoodRest: ". Llega a la tienda como llegaría Alexa+: MCP para el catálogo, sesiones de checkout UCP para el pago.",
  hoodEndpoint: "Endpoint MCP",
  hoodHandlers: "medios de pago",
  hoodNone: "ninguno",
  eachTurn: "Qué hizo cada turno",
  turnsNone: "Todavía no se ha dicho nada. Pregúntale algo a la tienda y esto se llena.",
  turnsTotals: "turnos {turns}, llamadas a herramientas {calls}, comprobaciones fallidas",
  firstItem: "primer ítem",
  idleTitle: "Háblale a la tienda",
  idleHintMic: "o aprieta el micrófono y habla",
  idleHintType: "escríbelo en la caja de abajo",
  askPlaceholder: "Alexa, pregúntale a {store}...",
  noAddon: "Sin complemento",
  mic: "micrófono",
  listening: "escuchando",
  send: "Enviar",
  micUnavailable: "El reconocimiento de voz no está disponible en este navegador",
  micSpeak: "Hablar",
  wentWrong: "Algo salió mal: {message}",
  scene: "Escena",
  checkout: "Checkout",
  statusReady: "listo para pagar",
  statusIncomplete: "todavía no está listo",
  statusCompleted: "pagado",
  statusCanceled: "cancelado",
  deliverTo: "Entregar a",
  personaNote: "Persona sintética del hogar de demostración",
  payWith: "Pagar con",
  noPayment: "Todavía no hay medio de pago conectado en el simulador para esta tienda.",
  simulated: "SIMULADO",
  testMode: "MODO PRUEBA",
  cancel: "Cancelar",
  confirm: "Confirmar {total}",
  confirming: "Confirmando",
  paying: "Pagando",
  yesOrderAgain: "Sí, pídelo de nuevo",
  historyTitle: "Tus compras aquí",
  historySince: "desde el {date}",
  historyOrders: "en {orders} pedidos pagados",
  historyNone: "Todavía no hay nada pagado aquí en este periodo.",
  historyTop: "Lo que más compras:",
  playground: "Demo pública",
  purchasesByVisitors: "Compras de visitantes:",
  purchasesNote: "(pagos simulados, con tope de $50 por pedido; nuestras propias escenas no se cuentan)",
  joinWaitlist: "Súmate a la lista",
  roleMerchant: "Vendo en línea y quiero mi tienda en Alexa+",
  roleShopper: "Quiero comprar así",
  emailPlaceholder: "tu@ejemplo.com",
  storeUrlOptional: "https://tu-tienda.ejemplo (opcional)",
  consent: "Escríbanme sobre AgentPOS para Alexa+. Nada más, y puedo pedir que me saquen.",
  join: "Sumarme",
  joining: "Sumando",
  merchantEyebrow: "consola del comerciante",
  merchantTitle: "Pon una tienda en Alexa+",
  merchantLede: "Cuatro pasos, cerca de un minuto. Un agente lee lo que la tienda ya publica y redacta cómo debería sonar en voz alta; tú lees cada línea y decides qué sale al aire.",
  backToSimulator: "Volver al simulador",
  step1: "Apunta a la tienda",
  step1Help: "Su propia dirección, la que usan sus clientes. El agente solo lee lo que la tienda publica, y nunca le escribe nada.",
  storeAddress: "Dirección de la tienda",
  language: "Idioma",
  readAndDraft: "Leerla y redactar",
  reading: "Leyendo la tienda",
  readingHelp: "Lee el catálogo y escribe, para cada producto, un nombre hablado, un resumen de una frase y las palabras que usaría un hogar.",
  step2: "Qué hizo el agente, cronometrado",
  step2Earlier: "Un borrador que quedó de antes",
  draftNotLive: "borrador, no está al aire",
  published: "publicado",
  draftedByModel: "Redactado por el modelo fuerte en Amazon Bedrock.",
  draftedByRules: "Redactado por el redactor determinista, sin modelo.",
  draftEarlierNote: " Nadie lo corrió en esta sesión: vuelve a leer la tienda para ver cada etapa tomar su tiempo.",
  stageScan: "Lectura",
  stageCatalog: "Borrador del catálogo",
  stagePolicies: "Borrador de políticas",
  stageConfirm: "Confirmación humana",
  stagePublished: "Publicado",
  stageFirstPurchase: "Primera compra por voz",
  urlToPublished: "De la URL a publicado:",
  urlToFirstPurchase: "De la URL a la primera compra por voz:",
  fromUsageEvents: "Calculado con las filas de etapa de usage_events.",
  notYet: "todavía no",
  staleWarning: "Cambió en la tienda después de publicar; se sirve con las palabras de la tienda hasta que vuelvas a confirmar:",
  step3: "Lee cada línea antes de que alguien la escuche",
  step3Help:
    "El nombre hablado es lo que dice el parlante en vez del título del catálogo. El resumen es la frase que escucha un cliente cuando pregunta por el producto. Los sinónimos son las palabras que un hogar usaría de verdad. Cambia lo que quieras: esto es el borrador, no la tienda.",
  colItem: "Producto",
  colSpokenName: "Nombre hablado",
  colSummary: "Resumen",
  colSynonyms: "Sinónimos",
  policiesTitle: "Lo que la tienda dice de sí misma",
  policiesHelp: "Tres frases que el asistente puede repetir: cómo se presenta la tienda, cómo entrega, y qué quiere que una persona revise antes de que un pedido salga.",
  policyIntro: "Presentación",
  policyDelivery: "Entrega",
  policyReview: "Revisión humana",
  step4Live: "Está al aire",
  step4Publish: "Publícalo",
  step4LiveNote: "Alexa+ ya responde por esta tienda con las palabras de arriba. Anda a",
  step4LiveLink: "pedirle algo",
  step4LiveRest: ", o cambia una línea y publica de nuevo.",
  step4Note: "Hasta que confirmes, el asistente responde con las palabras del catálogo de la tienda. Nada de esto está al aire todavía.",
  publishChanges: "Publicar los cambios",
  confirmAndPublish: "Confirmar y publicar",
  publishing: "Publicando",
};

const TABLE: Record<UiLang, Record<Key, string>> = { en: EN, es: ES };

/** `t("confirm", { total: "$13.00" })`. A missing variable is left as it was written. */
export function translate(lang: UiLang, key: Key, vars?: Record<string, string | number>): string {
  const text = TABLE[lang][key] ?? EN[key];
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

/** The translator for the chosen language, stable across renders while the choice holds. */
export function useT(): (key: Key, vars?: Record<string, string | number>) => string {
  const [lang] = useLang();
  return useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

/** The display modes Alexa+ can ask a view for, named the way a person would describe them. */
export const MODES = ["inline", "fullscreen", "voice-only", "hydrated"] as const;
export type ViewMode = (typeof MODES)[number];

export const MODE_TEXT: Record<UiLang, Record<ViewMode, { label: string; short: string; help: string }>> = {
  en: {
    inline: { label: "A card under the answer", short: "inline", help: "What an Echo Show does while the conversation continues around the card." },
    fullscreen: { label: "The whole screen", short: "fullscreen", help: "The view takes the screen, the way a recipe or a map would." },
    "voice-only": { label: "Voice only", short: "voice only", help: "No screen at all, like an Echo speaker. The answer has to stand on its own." },
    hydrated: { label: "The raw data too", short: "with data", help: "The card, and underneath it the data the store returned, for a host that renders its own." },
  },
  es: {
    inline: { label: "Una tarjeta bajo la respuesta", short: "en línea", help: "Lo que hace un Echo Show mientras la conversación sigue alrededor de la tarjeta." },
    fullscreen: { label: "La pantalla completa", short: "pantalla completa", help: "La vista se toma la pantalla, como lo haría una receta o un mapa." },
    "voice-only": { label: "Solo voz", short: "solo voz", help: "Sin pantalla, como un parlante Echo. La respuesta tiene que bastarse sola." },
    hydrated: { label: "También los datos crudos", short: "con datos", help: "La tarjeta y, debajo, los datos que devolvió la tienda, para un anfitrión que dibuja los suyos." },
  },
};

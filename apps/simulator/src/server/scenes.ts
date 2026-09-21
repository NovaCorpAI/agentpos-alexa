/**
 * Scenes: scripted, deterministic runs with prerecorded Household inputs, using the real
 * brain and a real Bridge (CONTEXT.md). The unit of demo and of the video. The web app
 * plays them step by step so the screen shows exactly what a judge would see.
 */
export type SceneStep =
  | { say: string; pauseMs?: number }
  /** Confirm the open checkout; answerReviewYes is the household's prerecorded "yes" if the guardian asks. */
  | { confirmCheckout: true; answerReviewYes?: boolean; pauseMs?: number }
  | { reset: true }
  /** Scan the add-on's Store in the Merchant console and wait until a human confirms the draft. */
  | { onboard: true };

export interface Scene {
  id: string;
  title: string;
  /** What the Scene proves, in one line for the inspection summary and the video. */
  proves: string;
  steps: SceneStep[];
  /** Set while a Scene depends on a ticket that has not landed. */
  pending?: string;
  /** The same Scene for a Spanish speaking household: its words, not a translation of ours. */
  es?: { title: string; proves: string; steps: SceneStep[] };
}

export const SCENES: Scene[] = [
  {
    id: "first-voice-purchase",
    title: "Scene 1: first voice purchase",
    proves: "Search, item card, checkout as the host pattern, order card and verified receipt, in one conversation.",
    steps: [{ reset: true }, { say: "What bread do you have?" }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true, answerReviewYes: true }, { say: "Show me the receipt" }],
    es: {
      title: "Escena 1: la primera compra por voz",
      proves: "Búsqueda, ficha del producto, checkout como patrón del anfitrión, tarjeta de pedido y boleta verificada, en una sola conversación.",
      steps: [{ reset: true }, { say: "¿Qué pan tienes?" }, { say: "Compra dos panes de masa madre" }, { confirmCheckout: true, answerReviewYes: true }, { say: "Muéstrame la boleta" }],
    },
  },
  {
    id: "gluten-free",
    title: "Scene 2: is it gluten free?",
    proves: "The answer comes only from what the store publishes; the agent never invents ingredients, and says when a fact is not published.",
    steps: [{ reset: true }, { say: "What bread do you have?" }, { say: "Is the seeded loaf gluten free?" }, { say: "Does the seeded loaf contain nuts?" }, { say: "Is the seeded loaf organic?" }],
    es: {
      title: "Escena 2: ¿es sin gluten?",
      proves: "La respuesta sale solo de lo que la tienda publica; el agente nunca inventa ingredientes, y dice cuándo un dato no está publicado.",
      steps: [{ reset: true }, { say: "¿Qué pan tienes?" }, { say: "¿El pan de semillas es sin gluten?" }, { say: "¿El pan de semillas tiene frutos secos?" }, { say: "¿El pan de semillas es orgánico?" }],
    },
  },
  {
    id: "duplicate-blocked",
    title: "Scene 3: duplicate order blocked",
    proves: "The guardian adds context to the store's policy and explains the block in one sentence.",
    steps: [{ reset: true }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true }],
    es: {
      title: "Escena 3: pedido duplicado bloqueado",
      proves: "El guardián le agrega contexto a la política de la tienda y explica el bloqueo en una frase.",
      steps: [{ reset: true }, { say: "Compra dos panes de masa madre" }, { confirmCheckout: true }, { say: "Compra dos panes de masa madre" }, { confirmCheckout: true }],
    },
  },
  {
    id: "same-as-last-week",
    title: "Scene 4: the same as last week",
    proves: "Household memory holds order references only and reorders on request.",
    // A fresh conversation on purpose: what it recalls comes from memory, not from the transcript.
    steps: [{ reset: true }, { say: "The same as last week" }, { confirmCheckout: true, answerReviewYes: true }],
    es: {
      title: "Escena 4: lo mismo de la semana pasada",
      proves: "La memoria del hogar guarda solo referencias de pedidos y vuelve a pedir cuando se lo piden.",
      steps: [{ reset: true }, { say: "Lo mismo de la semana pasada" }, { confirmCheckout: true, answerReviewYes: true }],
    },
  },
  {
    id: "onboarding",
    title: "Scene 5: onboarding, timed",
    proves: "From a store URL to a voice-ready catalog and policies, confirmed by a human, then the first purchase, timed from usage_events.",
    steps: [{ reset: true }, { onboard: true }, { say: "What bread do you have?" }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true, answerReviewYes: true }],
    es: {
      title: "Escena 5: onboarding, cronometrado",
      proves: "De la URL de una tienda a un catálogo y políticas listos para la voz, confirmados por una persona, y después la primera compra, cronometrada con usage_events.",
      steps: [{ reset: true }, { onboard: true }, { say: "¿Qué pan tienes?" }, { say: "Compra dos panes de masa madre" }, { confirmCheckout: true, answerReviewYes: true }],
    },
  },
];

/** The Scene list as a household in that language would hear it. English is the source. */
export function scenesFor(language: "en-US" | "es-CL"): Scene[] {
  if (language !== "es-CL") return SCENES.map(({ es, ...scene }) => ({ ...scene, ...(es ? { es } : {}) }));
  return SCENES.map((scene) => (scene.es ? { ...scene, title: scene.es.title, proves: scene.es.proves, steps: scene.es.steps } : scene));
}

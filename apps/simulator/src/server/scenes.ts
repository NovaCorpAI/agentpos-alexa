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
}

export const SCENES: Scene[] = [
  {
    id: "first-voice-purchase",
    title: "Scene 1: first voice purchase",
    proves: "Search, item card, checkout as the host pattern, order card and verified receipt, in one conversation.",
    steps: [{ reset: true }, { say: "What bread do you have?" }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true, answerReviewYes: true }, { say: "Show me the receipt" }],
  },
  {
    id: "gluten-free",
    title: "Scene 2: is it gluten free?",
    proves: "The answer comes only from what the store publishes; the agent never invents ingredients, and says when a fact is not published.",
    steps: [{ reset: true }, { say: "What bread do you have?" }, { say: "Is the seeded loaf gluten free?" }, { say: "Does the seeded loaf contain nuts?" }, { say: "Is the seeded loaf organic?" }],
  },
  {
    id: "duplicate-blocked",
    title: "Scene 3: duplicate order blocked",
    proves: "The guardian adds context to the store's policy and explains the block in one sentence.",
    steps: [{ reset: true }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true }],
  },
  {
    id: "same-as-last-week",
    title: "Scene 4: the same as last week",
    proves: "Household memory holds order references only and reorders on request.",
    // A fresh conversation on purpose: what it recalls comes from memory, not from the transcript.
    steps: [{ reset: true }, { say: "The same as last week" }, { confirmCheckout: true, answerReviewYes: true }],
  },
  {
    id: "onboarding",
    title: "Scene 5: onboarding, timed",
    proves: "From a store URL to a voice-ready catalog and policies, confirmed by a human, then the first purchase, timed from usage_events.",
    steps: [{ reset: true }, { onboard: true }, { say: "What bread do you have?" }, { say: "Buy two sourdough loaves" }, { confirmCheckout: true, answerReviewYes: true }],
  },
];

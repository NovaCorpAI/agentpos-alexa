/**
 * Merchant-side agents. Each one has a narrow role and a model chosen for its cost profile:
 *
 *   onboarding   strong model, once per store: URL -> voice-ready catalog draft -> proposed
 *                policies -> simulator package. A human confirms before anything is published.
 *   catalog      fast model, frequent: answers in conversation what a flat catalog cannot.
 *                Reads only the published catalog; never invents price or availability.
 *   guardian     strong model, only at checkout completion: adds context to the store's
 *                deterministic policy and can hand the order to the store's human approval queue.
 *
 * Runtime: Strands Agents SDK on Amazon Bedrock AgentCore Runtime (us-east-1).
 * Every call records usage_events (tokens, latency, model, estimated cost).
 */
export type AgentRole = "onboarding" | "catalog" | "guardian";

export interface AgentModelPolicy {
  role: AgentRole;
  /** Bedrock model id used for this role; from env, never hard-coded in callers. */
  modelEnvVar: "BEDROCK_MODEL_FAST" | "BEDROCK_MODEL_STRONG";
  /** Hard cap so a single call can never run away in cost. */
  maxOutputTokens: number;
}

export const AGENT_MODEL_POLICY: Readonly<Record<AgentRole, AgentModelPolicy>> = {
  onboarding: { role: "onboarding", modelEnvVar: "BEDROCK_MODEL_STRONG", maxOutputTokens: 4000 },
  catalog: { role: "catalog", modelEnvVar: "BEDROCK_MODEL_FAST", maxOutputTokens: 400 },
  guardian: { role: "guardian", modelEnvVar: "BEDROCK_MODEL_STRONG", maxOutputTokens: 600 },
};

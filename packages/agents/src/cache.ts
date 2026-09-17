/**
 * Prompt caching on Bedrock: what to ask the Strands SDK for, per model family.
 *
 * Two surprises, both measured (FL-011): the SDK's "auto" detection enables caching only for
 * model ids containing "anthropic" or "claude", so Amazon Nova, which Bedrock does cache, is
 * silently left out; and Nova then refuses a cache point inside `toolConfig.tools` and inside
 * `messages` ("extraneous key [cachePoint] is not permitted"), while Anthropic models accept
 * both. Nova caches the static prefix through the system checkpoint alone, which is where the
 * tool schemas and the prompt sit, so that is the only checkpoint we ask it for.
 */
export type CacheStrategy = "auto" | "anthropic";

export interface BedrockCacheConfig {
  strategy: CacheStrategy;
  toolsTTL?: boolean;
  messagesTTL?: boolean;
}

const ANTHROPIC = /(anthropic|claude)/i;
const NOVA = /nova/i;

export function cacheStrategyFor(modelId: string): CacheStrategy {
  return ANTHROPIC.test(modelId) || NOVA.test(modelId) ? "anthropic" : "auto";
}

/** Every checkpoint for Anthropic models; the system checkpoint alone for Nova. */
export function cacheConfigFor(modelId: string): BedrockCacheConfig {
  const strategy = cacheStrategyFor(modelId);
  return NOVA.test(modelId) && !ANTHROPIC.test(modelId) ? { strategy, toolsTTL: false, messagesTTL: false } : { strategy };
}

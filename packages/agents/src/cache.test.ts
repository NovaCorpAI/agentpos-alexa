import { describe, expect, it } from "vitest";
import { cacheConfigFor, cacheStrategyFor } from "./cache.js";

describe("cacheStrategyFor", () => {
  it("names the strategy for the families Bedrock caches, including Nova, and leaves the rest to auto", () => {
    expect(cacheStrategyFor("us.amazon.nova-2-lite-v1:0")).toBe("anthropic");
    expect(cacheStrategyFor("us.anthropic.claude-sonnet-4-6")).toBe("anthropic");
    expect(cacheStrategyFor("us.amazon.nova-pro-v1:0")).toBe("anthropic");
    expect(cacheStrategyFor("meta.llama3-70b-instruct-v1:0")).toBe("auto");
    // Nova refuses a cache point in toolConfig.tools and in messages; Anthropic models accept both.
    expect(cacheConfigFor("us.amazon.nova-2-lite-v1:0")).toEqual({ strategy: "anthropic", toolsTTL: false, messagesTTL: false });
    expect(cacheConfigFor("us.anthropic.claude-sonnet-4-6")).toEqual({ strategy: "anthropic" });
    expect(cacheConfigFor("meta.llama3-70b-instruct-v1:0")).toEqual({ strategy: "auto" });
  });
});

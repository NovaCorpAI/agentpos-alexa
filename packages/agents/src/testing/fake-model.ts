/**
 * A scripted Strands Model for tests: no network, deterministic tool calls and text, with
 * usage metadata so the usage_events path is exercised. Each call to stream() plays the
 * next scripted step.
 */
import { Model, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";

export type FakeStep = { toolUse: { name: string; input: Record<string, unknown> } } | { text: string };

export class FakeModel extends Model {
  private config = { modelId: "fake.model-v1" };
  readonly calls: Array<{ messages: Message[]; options: StreamOptions | undefined }> = [];

  constructor(private readonly script: FakeStep[]) {
    super();
  }

  updateConfig(modelConfig: { modelId: string }): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): { modelId: string } {
    return this.config;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.calls.push({ messages, options });
    const step = this.script.shift() ?? { text: "I have nothing more to add." };
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("toolUse" in step) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.toolUse.name, toolUseId: `tu_${this.calls.length}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.toolUse.input) } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    } else {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: step.text } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
    }
    yield { type: "modelMetadataEvent", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 }, metrics: { latencyMs: 42 } };
  }
}

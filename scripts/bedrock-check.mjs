// Loads .env into the process (never printed), lists the Bedrock models the account can
// invoke in the region, and makes one minimal Converse call with the fast model.
import { readFileSync } from "node:fs";
import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && m[2] !== "" && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const region = process.env.AWS_REGION || "us-east-1";
const fast = process.env.BEDROCK_MODEL_FAST;
const strong = process.env.BEDROCK_MODEL_STRONG;
console.log("region", region, "| fast", fast, "| strong", strong);

const bedrock = new BedrockClient({ region });
const { modelSummaries = [] } = await bedrock.send(new ListFoundationModelsCommand({}));
const interesting = modelSummaries.filter((m) => /nova-2-lite|nova-lite|sonnet/i.test(m.modelId ?? ""));
for (const m of interesting) console.log(`${m.modelId}  [${(m.inferenceTypesSupported ?? []).join(",")}]  ${m.modelLifecycle?.status ?? ""}`);

const runtime = new BedrockRuntimeClient({ region });
for (const modelId of [fast, strong]) {
  if (!modelId) continue;
  const started = Date.now();
  try {
    const res = await runtime.send(new ConverseCommand({ modelId, messages: [{ role: "user", content: [{ text: "Reply with the single word: ready" }] }], inferenceConfig: { maxTokens: 10 } }));
    const text = res.output?.message?.content?.map((c) => c.text ?? "").join("").trim();
    console.log(`OK ${modelId}: "${text}" in ${Date.now() - started} ms, usage ${JSON.stringify(res.usage)}`);
  } catch (e) {
    console.log(`FAIL ${modelId}: ${e.name}: ${String(e.message).slice(0, 200)}`);
  }
}

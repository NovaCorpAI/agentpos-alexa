/**
 * Voice output through Amazon Polly (generative engine), cached per phrase on disk so a
 * Scene replays instantly and costs nothing the second time. When Polly is not reachable
 * (no credentials, no permission) the endpoint answers 503 and the browser speaks instead.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

export type SpeechLanguage = "en-US" | "es-CL";

/** Generative voices per language. es-CL is not offered; Lupe (es-US) is the closest neutral Spanish. */
export const VOICES: Record<SpeechLanguage, { voiceId: string; languageCode: string }> = {
  "en-US": { voiceId: "Joanna", languageCode: "en-US" },
  "es-CL": { voiceId: "Lupe", languageCode: "es-US" },
};

export interface SpeechResult {
  audio: Buffer;
  contentType: "audio/mpeg";
  cached: boolean;
  voiceId: string;
  latencyMs: number;
}

export class PollySpeech {
  private readonly client: PollyClient;
  private disabledReason: string | undefined;

  constructor(
    region: string,
    private readonly cacheDir: string,
  ) {
    this.client = new PollyClient({ region });
    mkdirSync(cacheDir, { recursive: true });
  }

  get disabled(): string | undefined {
    return this.disabledReason;
  }

  private cachePath(voiceId: string, text: string): string {
    const key = createHash("sha256").update(`${voiceId}\n${text}`).digest("hex");
    return resolve(this.cacheDir, `${key}.mp3`);
  }

  async synthesize(text: string, language: SpeechLanguage): Promise<SpeechResult> {
    const voice = VOICES[language];
    const path = this.cachePath(voice.voiceId, text);
    if (existsSync(path)) return { audio: readFileSync(path), contentType: "audio/mpeg", cached: true, voiceId: voice.voiceId, latencyMs: 0 };
    if (this.disabledReason) throw new Error(this.disabledReason);
    const started = performance.now();
    try {
      const res = await this.client.send(
        new SynthesizeSpeechCommand({ Engine: "generative", VoiceId: voice.voiceId as "Joanna", LanguageCode: voice.languageCode as "en-US", OutputFormat: "mp3", Text: text.slice(0, 1500) }),
      );
      const audio = Buffer.from(await res.AudioStream!.transformToByteArray());
      writeFileSync(path, audio);
      return { audio, contentType: "audio/mpeg", cached: false, voiceId: voice.voiceId, latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (/Credentials|AccessDenied|UnrecognizedClient|InvalidSignature/i.test(name) || /credentials/i.test(String((e as Error).message))) {
        this.disabledReason = `Polly unavailable (${name || "no credentials"}); the browser voice is used instead.`;
      }
      throw e;
    }
  }
}

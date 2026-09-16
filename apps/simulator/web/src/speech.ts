/**
 * Voice in and out. Output tries the Simulator's Polly endpoint first (generative voice,
 * cached per phrase) and falls back to the browser's own voice when it answers 503 or
 * fails; input is the browser's speech recognition. Both degrade to text.
 */
export type SpeechSource = "polly" | "browser" | "none";

let current: HTMLAudioElement | null = null;

function browserSpeak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** Speaks and resolves when playback ends, so a Scene can pace its steps. */
export async function speak(text: string, lang = "en-US"): Promise<SpeechSource> {
  if (!text.trim()) return "none";
  try {
    const res = await fetch(`/api/speech?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (current) {
        current.pause();
        current = null;
      }
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return "polly";
    }
  } catch {
    // fall through to the browser voice
  }
  await browserSpeak(text, lang);
  return "browser";
}

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export function recognitionAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function listenOnce(lang: string, onText: (text: string) => void, onEnd: () => void): () => void {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onEnd();
    return () => undefined;
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const t = ev.results[0]?.[0]?.transcript;
    if (t) onText(t);
  };
  rec.onerror = () => onEnd();
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}

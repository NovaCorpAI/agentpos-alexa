/**
 * Clean-up for model text that will be spoken or shown: no em or en dashes (a project rule
 * for all generated text), no markdown emphasis, single spaces.
 */
export function spokenText(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\*\*?|__/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

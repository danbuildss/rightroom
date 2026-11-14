/**
 * Finding the sentence on a source page that supports a claim, so a reviewer
 * can confirm with one click instead of hunting for it. This only *suggests*:
 * a person still decides whether the sentence really supports the claim.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can for from has have in into is it its of on or our that the their them " +
    "they this to was we were will with you your new now more all any about after also than then there these " +
    "which who what when where how not no one two over out up so"
  ).split(" "),
);

/** Meaningful lowercase words (3+ letters, not stopwords). */
export function keywords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .match(/[a-z0-9][a-z0-9.\-+]*[a-z0-9]|[a-z0-9]/g) ?? []
  ).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Split page text into sentences of a readable length. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 600);
}

export interface EvidenceMatch {
  sentence: string;
  /** Share of the claim's meaningful words found in the sentence, 0–1. */
  score: number;
}

/** The sentences that best match the claim, best first. Only matches above `min` are returned. */
export function bestMatches(
  claim: string,
  pageText: string,
  options: { limit?: number; min?: number } = {},
): EvidenceMatch[] {
  const wanted = [...new Set(keywords(claim))];
  if (wanted.length === 0) return [];
  const matches = sentences(pageText)
    .map((sentence) => {
      const words = new Set(keywords(sentence));
      const hits = wanted.filter((w) => words.has(w)).length;
      return { sentence, score: Math.round((hits / wanted.length) * 100) / 100 };
    })
    .filter((m) => m.score >= (options.min ?? 0.3));
  matches.sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length);
  const seen = new Set<string>();
  return matches.filter((m) => !seen.has(m.sentence) && seen.add(m.sentence)).slice(0, options.limit ?? 3);
}

/** Does a page appear to belong to this company? (its name shows up in the title or text) */
export function mentionsCompany(name: string, pageTitle: string | null, pageText: string): boolean {
  const core = name
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(inc|ltd|llc|labs|ai|protocol|network|platform)\b\.?/gi, " ")
    .trim()
    .toLowerCase();
  if (core.length < 2) return false;
  const haystack = `${pageTitle ?? ""} ${pageText.slice(0, 20_000)}`.toLowerCase();
  return haystack.includes(core);
}

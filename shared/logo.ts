/** Pure helpers for company logos (used by worker/db/logos.ts): what an image is, and where a homepage points to its icon. */

export type LogoType = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/x-icon";

/** What the first bytes say the image is, or null when it isn't a raster image we accept. */
export function sniffImage(b: Uint8Array): LogoType | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45)
    return "image/webp";
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0) return "image/x-icon";
  return null;
}

/** Icon links in a homepage, best first: apple-touch-icon, then the largest non-SVG icon. */
export function iconCandidates(html: string, base: string): string[] {
  const found: { url: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
    const rel = attr("rel")?.toLowerCase() ?? "";
    const href = attr("href");
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) continue;
    if (/\.svg(\?|$)/i.test(href) || attr("type")?.includes("svg")) continue;
    let url: string;
    try {
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    const size = Number(attr("sizes")?.match(/(\d+)x\d+/)?.[1] ?? 0);
    found.push({ url, score: (rel.includes("apple-touch-icon") ? 1000 : 0) + Math.min(size, 512) });
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.url);
}

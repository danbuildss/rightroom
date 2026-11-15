import { describe, expect, it } from "vitest";
import { iconCandidates, sniffImage } from "../shared/logo.ts";

describe("logo helpers", () => {
  it("accepts raster images by their first bytes and refuses SVG or HTML", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe("image/x-icon");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html>"))).toBeNull();
  });

  it("ranks apple-touch-icon first, then larger icons, and skips SVG", () => {
    const html = `<head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="icon" href="/favicon-96.png" sizes="96x96">
      <link href="/apple.png" rel="apple-touch-icon">
    </head>`;
    expect(iconCandidates(html, "https://example.com/")).toEqual([
      "https://example.com/apple.png",
      "https://example.com/favicon-96.png",
      "https://example.com/favicon-16.png",
    ]);
  });
});

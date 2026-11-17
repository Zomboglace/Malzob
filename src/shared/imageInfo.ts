/**
 * Detects the format and natural pixel size of an image from its bytes.
 * Supports PNG, JPEG and WebP (lossy, lossless and extended). Pure: works on
 * a Uint8Array, so it runs anywhere and is easy to test.
 */
import type { ImageExt } from "./types.ts";

export interface ImageInfo {
  ext: ImageExt;
  width: number;
  height: number;
}

export const IMAGE_MIME: Record<ImageExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

function ascii(b: Uint8Array, start: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (b[start + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function readImageInfo(b: Uint8Array): ImageInfo | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const has = (n: number) => b.length >= n;

  // PNG: signature, then the IHDR chunk holds width/height (big endian).
  if (has(24) && b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n") && ascii(b, 12, "IHDR")) {
    return positive({ ext: "png", width: view.getUint32(16), height: view.getUint32(20) });
  }

  // JPEG: walk the segments until a Start Of Frame marker.
  if (has(4) && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++; // padding
        continue;
      }
      const length = view.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return positive({ ext: "jpg", height: view.getUint16(i + 5), width: view.getUint16(i + 7) });
      i += 2 + length;
    }
    return null;
  }

  // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
  if (has(30) && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    if (ascii(b, 12, "VP8 ")) {
      return positive({ ext: "webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff });
    }
    if (ascii(b, 12, "VP8L")) {
      const bits = view.getUint32(21, true);
      return positive({ ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 });
    }
    if (ascii(b, 12, "VP8X")) {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return positive({ ext: "webp", width: w, height: h });
    }
  }
  return null;
}

function positive(info: ImageInfo): ImageInfo | null {
  return info.width > 0 && info.height > 0 ? info : null;
}

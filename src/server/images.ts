/**
 * Uploaded images, stored on disk by content hash: `data/images/<sha256>.<ext>`.
 * Uploading the same file twice stores it once.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readImageInfo } from "../shared/imageInfo.ts";
import type { ImageRef } from "../shared/types.ts";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FILE_RE = /^([0-9a-f]{64})\.(png|jpg|webp)$/;

export class ImageStore {
  readonly dir: string;
  private readonly byHash = new Map<string, ImageRef>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "images");
    mkdirSync(this.dir, { recursive: true });
    for (const file of readdirSync(this.dir)) {
      if (!FILE_RE.test(file)) continue;
      const info = readImageInfo(readFileSync(join(this.dir, file)));
      const hash = file.slice(0, 64);
      if (info) this.byHash.set(hash, { hash, ...info });
    }
  }

  get(hash: string): ImageRef | undefined {
    return this.byHash.get(hash);
  }

  /** Validates and stores an image. Returns null if the bytes are not a supported image. */
  add(bytes: Uint8Array): ImageRef | null {
    const info = readImageInfo(bytes);
    if (!info) return null;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = this.byHash.get(hash);
    if (existing) return existing;
    writeFileSync(join(this.dir, `${hash}.${info.ext}`), bytes);
    const ref: ImageRef = { hash, ...info };
    this.byHash.set(hash, ref);
    return ref;
  }

  /** Absolute path of a stored file, from its public file name; null if unknown. */
  pathFor(fileName: string): string | null {
    const match = FILE_RE.exec(fileName);
    if (!match) return null;
    const ref = this.byHash.get(match[1]!);
    if (!ref || ref.ext !== match[2]) return null;
    return join(this.dir, fileName);
  }
}

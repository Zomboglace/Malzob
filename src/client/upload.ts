/** Uploads an image file to the server over HTTP and returns its hash. */
import { IMAGE_MIME } from "../shared/imageInfo.ts";
import type { ImageRef } from "../shared/types.ts";

/** Must match MAX_IMAGE_BYTES on the server. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = Object.values(IMAGE_MIME);

export type Uploader = (file: Blob) => Promise<ImageRef>;

export function createUploader(fetchImpl: typeof fetch = fetch): Uploader {
  return async (file) => {
    if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Only PNG, JPEG and WebP images are accepted.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`Image too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
    const res = await fetchImpl("/api/images", { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const body = (await res.json()) as ImageRef | { error: string };
    if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `Upload failed (${res.status})`);
    return body;
  };
}

export function imageUrl(ref: ImageRef): string {
  return `/images/${ref.hash}.${ref.ext}`;
}

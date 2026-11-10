/**
 * Recognising an uploaded image by what it is rather than what it claims.
 *
 * Shared by every reader that takes a photograph — a loan page, a policy
 * schedule — because the alternative is each one trusting a file extension or
 * a `type` the browser guessed. A mislabelled file sent on as a media type it
 * isn't comes back from the API as an opaque 400, which surfaces to the owner
 * as "reading failed" for a picture that was perfectly readable.
 */

/** What the API accepts, and what a phone actually produces. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The file's own first bytes, rather than whatever the upload claimed. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // "RIFF" .... "WEBP"
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)) {
    return "image/webp";
  }
  return null;
}

/** An uploaded picture, ready to attach to a message. */
export interface UploadedImage {
  data: string;
  mediaType: ImageType;
}

/**
 * The pictures in a request, or what was wrong with them.
 *
 * Several, because a statement photographed on a phone is a page per picture
 * and the pages belong to one document: read separately they would produce a
 * policy per page, each missing whatever sat on the others.
 */
export function readImages(raw: unknown): { images: UploadedImage[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) return { error: "no image content" };
  // A generous ceiling rather than no ceiling: a statement runs to a few
  // pages, and an unbounded list is an unbounded request to the model.
  if (list.length > 12) return { error: "That is more pages than a statement should need — 12 at a time at most." };

  const images: UploadedImage[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") return { error: "no image content" };
    const mediaType = sniffImageType(new Uint8Array(Buffer.from(entry, "base64")));
    if (!mediaType) return { error: "That doesn't look like an image. A PNG, JPEG, GIF or WebP photo or screenshot works." };
    images.push({ data: entry, mediaType });
  }
  return { images };
}

import { describe, expect, it } from "vitest";
import { readImages, sniffImageType } from "./imageBytes.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
const pdf = Buffer.from("%PDF-1.7").toString("base64");

describe("sniffImageType", () => {
  it("knows the formats a phone produces", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif");

    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  /**
   * Read from the bytes rather than from a file extension or the type the
   * browser guessed. A mislabelled file passed on as a media type it is not
   * comes back from the API as an opaque 400, which reaches the owner as
   * "reading failed" for a picture that was perfectly readable.
   */
  it("refuses something that is not an image", () => {
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("readImages", () => {
  it("takes a single picture", () => {
    const read = readImages(png);
    expect("images" in read && read.images).toEqual([{ data: png, mediaType: "image/png" }]);
  });

  // A statement photographed on a phone is a page per picture, and the pages
  // belong to one document.
  it("takes several pages, keeping their order", () => {
    const read = readImages([png, jpeg]);
    expect("images" in read && read.images.map((i) => i.mediaType)).toEqual(["image/png", "image/jpeg"]);
  });

  it("refuses a file that is not an image at all", () => {
    expect(readImages(pdf)).toEqual({ error: expect.stringContaining("doesn't look like an image") });
  });

  // One unreadable page among good ones is still a failed read: carrying on
  // without it would silently drop whatever was on that page.
  it("refuses the whole set when one page is not an image", () => {
    expect("error" in readImages([png, pdf])).toBe(true);
  });

  it("says so when nothing was sent", () => {
    expect(readImages([])).toEqual({ error: "no image content" });
    expect(readImages(undefined)).toEqual({ error: "no image content" });
  });

  // A generous ceiling rather than none: an unbounded list is an unbounded
  // request to the model.
  it("declines more pages than a statement should need", () => {
    expect("error" in readImages(new Array(13).fill(png))).toBe(true);
    expect("images" in readImages(new Array(12).fill(png))).toBe(true);
  });
});

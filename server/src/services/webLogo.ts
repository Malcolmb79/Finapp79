/**
 * Fetches a bank's logo from the open internet, for banks Enable Banking's
 * directory doesn't cover.
 *
 * The directory is a PSD2 list, so it is European by construction — a South
 * African or US account will never be found there no matter how well its name
 * matches. This is the fallback for those.
 *
 * Two deliberate constraints:
 *
 * 1. The only host ever contacted is the icon service below. A model supplies
 *    a *domain*, which becomes a query parameter — never a URL to fetch. So a
 *    wrong or invented domain yields a wrong icon or none, and cannot make the
 *    server issue a request to an arbitrary address.
 *
 * 2. The image is stored, not linked. A stored https URL would mean the
 *    browser re-requesting it from a third party on every page load, telling
 *    that third party which banks the user holds accounts with, forever. One
 *    fetch here, held as a data URI, keeps that between the user and their own
 *    database — and the logo survives the service going away.
 */

const ICON_SERVICE = "https://www.google.com/s2/favicons";

// A hostname and nothing else: no scheme, no port, no path, no credentials.
// The value is only ever a query parameter, but keeping it to this shape means
// a malformed answer is rejected here rather than sent on.
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// Comfortably above a 128px PNG icon and far below anything worth holding in
// a row that gets selected on every page load.
const MAX_BYTES = 200_000;

export function isValidDomain(domain: string): boolean {
  return domain.length <= 253 && DOMAIN.test(domain) && !/^\d+(\.\d+)*$/.test(domain);
}

export async function fetchLogoDataUri(domain: string): Promise<string | null> {
  if (!isValidDomain(domain)) return null;

  try {
    const res = await fetch(`${ICON_SERVICE}?domain=${encodeURIComponent(domain)}&sz=128`);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;

    return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch (err) {
    // A missing logo is cosmetic; never fail the user's request over it.
    console.error("Logo fetch failed:", err);
    return null;
  }
}

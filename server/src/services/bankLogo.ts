import * as enableBanking from "./enableBanking.js";

/**
 * Matches a bank name read off a statement against Enable Banking's ASPSP
 * directory, so an imported statement can carry the real bank's logo instead
 * of leaving a manual account with a blank avatar.
 *
 * The directory is the same one the bank-link flow lists, so a logo resolved
 * here is the identical asset a linked account of that bank would show — the
 * two paths can't drift apart.
 */

export interface ResolvedBank {
  name: string;
  logo: string | null;
  country: string;
}

// Words that carry no identifying weight: matching "Bank of Ireland" against
// "Bank" should not succeed, and "AIB plc" and "AIB" are the same institution.
const NOISE = /\b(bank|banking|banca|banco|banque|plc|ltd|limited|group|nv|n\.v\.|sa|s\.a\.|ag|as|plc\.|the)\b/gi;

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Scores a candidate against the statement's bank name. Exact beats prefix
// beats containment, and a longer overlap beats a shorter one, so "Bank of
// Ireland" doesn't win over "Bank of Ireland 365" purely by being shorter.
function score(target: string, candidate: string): number {
  if (!target || !candidate) return 0;
  if (target === candidate) return 1000;
  if (candidate.startsWith(target) || target.startsWith(candidate)) return 500 + Math.min(target.length, candidate.length);
  if (candidate.includes(target) || target.includes(candidate)) return 100 + Math.min(target.length, candidate.length);

  // Fall back to shared words, so "AIB Cheque Account" still finds "AIB".
  const targetWords = new Set(target.split(" ").filter((w) => w.length > 2));
  const shared = candidate.split(" ").filter((w) => w.length > 2 && targetWords.has(w));
  return shared.length === 0 ? 0 : shared.join("").length;
}

// Below this, a "match" is one incidental shared word — more likely to attach
// the wrong bank's logo than to be right, and a wrong logo is worse than none.
const MIN_SCORE = 4;

export async function resolveBank(bankName: string | null | undefined, country: string | null | undefined): Promise<ResolvedBank | null> {
  if (!bankName || !country || !/^[A-Za-z]{2}$/.test(country)) return null;

  const target = normalise(bankName);
  if (!target) return null;

  try {
    const aspsps = await enableBanking.listAspsps(country.toUpperCase());
    let best: { aspsp: enableBanking.Aspsp; score: number } | null = null;
    for (const aspsp of aspsps) {
      const candidateScore = score(target, normalise(aspsp.name));
      if (candidateScore > (best?.score ?? 0)) best = { aspsp, score: candidateScore };
    }

    if (!best || best.score < MIN_SCORE) return null;
    return { name: best.aspsp.name, logo: best.aspsp.logo ?? null, country: country.toUpperCase() };
  } catch (err) {
    // The directory being unreachable shouldn't fail an import — the
    // statement still parses, the account just keeps its current avatar.
    console.error("Bank logo lookup failed:", err);
    return null;
  }
}

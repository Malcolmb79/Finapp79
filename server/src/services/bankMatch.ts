import Anthropic from "@anthropic-ai/sdk";
import * as enableBanking from "./enableBanking.js";
import { resolveBank, type ResolvedBank } from "./bankLogo.js";

/**
 * Finds the bank behind an account's own name, so an account created by hand
 * can carry its bank's logo without a statement import.
 *
 * bankLogo.ts already matches a bank name read off a statement, but it works
 * on string overlap, which is the wrong tool for what people actually call
 * their accounts. "Joint a/c BOI", "Revolut spending" and "AIB - bills" all
 * name a real institution that shares almost no characters with the directory
 * entry. A model reads those the way a person does.
 *
 * The safeguard is the same one used for categorisation: the model chooses
 * from an enumerated list of real directory entries and can answer "none". It
 * never supplies a name of its own and never supplies a URL — the logo comes
 * from the directory row its answer maps back to, so a hallucinated bank
 * cannot become a hallucinated image.
 */

const MODEL = "claude-opus-5";

// Returned when an account name names no bank at all — "Current-053",
// "Savings", "Joint account". A wrong logo is worse than a blank avatar, so
// this has to be as easy for the model to say as any bank name.
const NO_MATCH = "__none__";

function buildSchema(bankNames: string[]) {
  return {
    type: "object",
    properties: {
      bank: { type: "string", enum: [...bankNames, NO_MATCH] },
      // Not used to gate the result — the user confirms before anything is
      // written — but shown to them, so "probably Revolut" and "definitely
      // AIB" are distinguishable at a glance.
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["bank", "confidence"],
    additionalProperties: false,
  };
}

export interface BankMatch extends ResolvedBank {
  confidence: "high" | "medium" | "low";
}

/**
 * @param accountName What the user called the account — the primary signal.
 * @param institutionName A bank name already on the account, if any.
 * @param country Two-letter code; the directory is listed per country.
 */
export async function matchBankToAccount(
  accountName: string,
  institutionName: string | null,
  country: string
): Promise<BankMatch | null> {
  // The cheap deterministic path first: an account literally called "AIB
  // Current" needs no model call, and its answer is the same asset.
  const direct = await resolveBank(institutionName ?? accountName, country);
  if (direct) return { ...direct, confidence: "high" };

  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const aspsps = await enableBanking.listAspsps(country.toUpperCase());
    // Enable Banking lists a bank once per authentication method, so the same
    // institution can appear several times over. Deduplicating keeps the enum
    // to real choices rather than the same name repeated.
    const byName = new Map<string, enableBanking.Aspsp>();
    for (const aspsp of aspsps) {
      if (!byName.has(aspsp.name)) byName.set(aspsp.name, aspsp);
    }
    const names = [...byName.keys()];
    if (names.length === 0) return null;

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: buildSchema(names) },
      },
      system:
        "You identify which bank an account belongs to, given the name its owner gave it. People abbreviate, use initials, and mix in what the account is for — recognise the institution behind that. Answer with no match unless the name genuinely points at one of the listed banks.",
      messages: [
        {
          role: "user",
          content: [
            `Account name: ${accountName}`,
            institutionName ? `Institution recorded on the account: ${institutionName}` : "",
            "",
            `Banks available in ${country.toUpperCase()}:`,
            ...names.map((name) => `- ${name}`),
            "",
            `Which one is this account with? Answer "${NO_MATCH}" if the name names no bank — plenty of accounts are called things like "Current-053" or "Joint savings", and a wrong logo is worse than none.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return null;

    const parsed = JSON.parse(text.text) as { bank: string; confidence: "high" | "medium" | "low" };
    if (!parsed.bank || parsed.bank === NO_MATCH) return null;

    const aspsp = byName.get(parsed.bank);
    if (!aspsp) return null;

    return {
      name: aspsp.name,
      logo: aspsp.logo ?? null,
      country: country.toUpperCase(),
      confidence: parsed.confidence ?? "medium",
    };
  } catch (err) {
    // A blank avatar is a cosmetic problem — never worth failing a request
    // the user made about their account.
    console.error("Bank match failed:", err);
    return null;
  }
}

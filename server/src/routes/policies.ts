import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { extractPdfText, looksLikePdf } from "../services/pdfStatement.js";
import { extractPolicyFacts } from "../services/policyDocument.js";

/**
 * Life insurance policies.
 *
 * A policy is held apart from `accounts` on purpose — see the comment on the
 * table in schema.sql. What that costs is this file; what it buys is that no
 * account dropdown, statement importer or debt projection ever has to learn to
 * ignore a policy.
 */

export const policiesRouter = Router();
policiesRouter.use(requireAuth);

/** The figure a policy contributes to net worth, if any. */
const NET_WORTH_SOURCES = new Set(["none", "surrender", "cover"]);
const FREQUENCIES = new Set(["monthly", "quarterly", "annual"]);

// The same bounds the document reader applies, so a figure typed in by hand is
// held to the standard a read one is.
const BOUNDS: Record<string, { min: number; max: number }> = {
  cover_amount: { min: 0, max: 1_000_000_000 },
  surrender_value: { min: 0, max: 1_000_000_000 },
  premium: { min: 0, max: 1_000_000 },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface PolicyRow {
  id: string;
  cover_amount: number | null;
  surrender_value: number | null;
  valued_at: string | null;
}

/**
 * A policy with its valuation history attached.
 *
 * The history rides along with the list rather than sitting behind its own
 * endpoint: the net worth trend needs every policy's earliest valuation date to
 * decide when each one starts contributing, and fetching that per policy would
 * be a request per card on every dashboard render.
 */
async function listPolicies(userId: string) {
  const policies = (await db
    .prepare("SELECT * FROM policies WHERE user_id = ? ORDER BY created_at")
    .all(userId)) as unknown as Record<string, unknown>[];

  if (policies.length === 0) return [];

  const valuations = (await db
    .prepare(
      `SELECT policy_id, valued_at, cover_amount, surrender_value
         FROM policy_valuations WHERE user_id = ? ORDER BY valued_at`
    )
    .all(userId)) as unknown as { policy_id: string }[];

  return policies.map((policy) => ({
    ...policy,
    valuations: valuations.filter((v) => v.policy_id === policy.id),
  }));
}

policiesRouter.get("/", async (req, res) => {
  res.json(await listPolicies(req.user!.id));
});

/**
 * Reads a policy document and returns what it says, for confirmation.
 *
 * Writes nothing — the same contract as the loan agreement reader it mirrors.
 * Unscoped to a policy on purpose: the upload comes before the policy exists,
 * and a later statement for an existing policy goes through the same door.
 */
policiesRouter.post("/preview", async (req, res) => {
  const { content_base64, content } = req.body as { content_base64?: unknown; content?: unknown };
  let text: string;

  if (typeof content_base64 === "string") {
    const buffer = Buffer.from(content_base64, "base64");
    // A Buffer is a Uint8Array, but unpdf checks the constructor and rejects
    // it outright — so the conversion is not the formality it looks like.
    const bytes = new Uint8Array(buffer);
    try {
      text = looksLikePdf(bytes) ? await extractPdfText(bytes) : buffer.toString("utf8");
    } catch (err) {
      console.error("Policy text extraction failed:", err);
      res.status(422).json({ error: "That PDF couldn't be opened. If it's password-protected, save an unlocked copy and try again." });
      return;
    }
  } else if (typeof content === "string") {
    text = content;
  } else {
    res.status(400).json({ error: "no file content" });
    return;
  }

  if (text.trim().length < 50) {
    res.status(422).json({
      error: "Nothing readable in that file — if it's a scan rather than a text PDF, the details can't be read from it.",
    });
    return;
  }

  try {
    const facts = await extractPolicyFacts(text);
    if (!facts) {
      res.status(503).json({ error: "Reading policy documents is unavailable — the AI key is not configured. You can still enter the figures by hand." });
      return;
    }
    res.json(facts);
  } catch (err) {
    console.error("Policy reading failed:", err);
    res.status(502).json({ error: "Reading the document failed part-way through. Worth trying again." });
  }
});

/**
 * A figure from the request body, held to the same bounds the document reader
 * applies — so a number typed in by hand is checked as carefully as one read
 * out of a statement.
 *
 * Three outcomes, and the third is the one that matters: `null` is a figure
 * deliberately cleared, a number is a figure accepted, and `undefined` means
 * reject the request. Collapsing "rejected" into "cleared" would turn a
 * fat-fingered cover amount into a silent erasure of the real one.
 */
export function money(value: unknown, column: string): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const bounds = BOUNDS[column];
  if (!bounds) return undefined;
  if (value < bounds.min || value > bounds.max) return undefined;
  return value;
}

/** Same three-way result as `money`, for a date the app stores as ISO text. */
export function isoDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) return undefined;
  // A shape-only check would accept 2026-02-31 and store it. Round-tripping is
  // what catches a date that rolled over into a different one.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

policiesRouter.post("/", async (req, res) => {
  const { name, insurer, policy_number, currency, valued_at, premium_frequency, start_date, maturity_date, extract } = req.body;

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const cover = money(req.body.cover_amount ?? null, "cover_amount");
  const surrender = money(req.body.surrender_value ?? null, "surrender_value");
  const premiumAmount = money(req.body.premium ?? null, "premium");
  if (cover === undefined || surrender === undefined || premiumAmount === undefined) {
    res.status(400).json({ error: "a figure is outside the range a policy plausibly states" });
    return;
  }

  const valuedAt = isoDate(valued_at ?? null);
  const startDate = isoDate(start_date ?? null);
  const maturityDate = isoDate(maturity_date ?? null);
  if (valuedAt === undefined || startDate === undefined || maturityDate === undefined) {
    res.status(400).json({ error: "dates must be YYYY-MM-DD" });
    return;
  }

  const source = typeof req.body.net_worth_source === "string" ? req.body.net_worth_source : "none";
  if (!NET_WORTH_SOURCES.has(source)) {
    res.status(400).json({ error: "net_worth_source must be none, surrender or cover" });
    return;
  }

  const frequency = premium_frequency == null ? null : FREQUENCIES.has(premium_frequency) ? premium_frequency : undefined;
  if (frequency === undefined) {
    res.status(400).json({ error: "premium_frequency must be monthly, quarterly or annual" });
    return;
  }

  const id = randomUUID();

  // The policy and its first valuation are one fact recorded two ways — a
  // policy whose history doesn't include the figure on its own card would make
  // the net worth trend disagree with the card from the moment it was created.
  const created = await withTransaction(async (tx) => {
    const row = await tx
      .prepare(
        `INSERT INTO policies (id, user_id, name, insurer, policy_number, currency, cover_amount, surrender_value,
                               valued_at, premium, premium_frequency, start_date, maturity_date, net_worth_source, extract_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(
        id,
        req.user!.id,
        name.trim(),
        insurer ?? null,
        policy_number ?? null,
        typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "USD",
        cover,
        surrender,
        valuedAt,
        premiumAmount,
        frequency,
        startDate,
        maturityDate,
        source,
        extract ? JSON.stringify(extract) : null
      );

    // Always dated, even when the document didn't state an "as at". The
    // policy's own `valued_at` stays null in that case, because claiming a date
    // the statement doesn't give would be inventing one — but the history entry
    // records when the figure became known, which is a different and honest
    // claim, and today is exactly that date.
    //
    // Every policy carrying at least one dated valuation is also what keeps the
    // net worth trend ending on the same figure the headline shows: a policy
    // with no dated statement would contribute to the total and to no point on
    // the line, and the two would quietly disagree.
    if (cover != null || surrender != null) {
      await tx
        .prepare(
          `INSERT INTO policy_valuations (id, user_id, policy_id, valued_at, cover_amount, surrender_value)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), req.user!.id, id, valuedAt ?? new Date().toISOString().slice(0, 10), cover, surrender);
    }

    return row;
  });

  res.status(201).json(created);
});

/**
 * Edits a policy.
 *
 * Only touches fields actually present in the body (`"field" in req.body`), not
 * merely truthy ones — the same reasoning as PATCH /transactions/:id: clearing a
 * figure back to null has to be distinguishable from leaving it alone.
 */
policiesRouter.patch("/:id", async (req, res) => {
  const existing = await db
    .prepare("SELECT id FROM policies WHERE id = ? AND user_id = ?")
    .get<{ id: string }>(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "policy not found" });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  for (const column of ["name", "insurer", "policy_number"] as const) {
    if (!(column in req.body)) continue;
    const value = req.body[column];
    if (value !== null && typeof value !== "string") {
      res.status(400).json({ error: `${column} must be text` });
      return;
    }
    updates.push(`${column} = ?`);
    params.push(column === "name" ? (value ?? "").trim() || "Policy" : value);
  }

  for (const column of ["cover_amount", "surrender_value", "premium"] as const) {
    if (!(column in req.body)) continue;
    const value = money(req.body[column], column);
    if (value === undefined) {
      res.status(400).json({ error: `${column} is outside the range a policy plausibly states` });
      return;
    }
    updates.push(`${column} = ?`);
    params.push(value);
  }

  for (const column of ["valued_at", "start_date", "maturity_date"] as const) {
    if (!(column in req.body)) continue;
    const value = isoDate(req.body[column]);
    if (value === undefined) {
      res.status(400).json({ error: `${column} must be YYYY-MM-DD` });
      return;
    }
    updates.push(`${column} = ?`);
    params.push(value);
  }

  if ("premium_frequency" in req.body) {
    const value = req.body.premium_frequency;
    if (value !== null && !FREQUENCIES.has(value)) {
      res.status(400).json({ error: "premium_frequency must be monthly, quarterly or annual" });
      return;
    }
    updates.push("premium_frequency = ?");
    params.push(value);
  }

  if ("currency" in req.body) {
    if (typeof req.body.currency !== "string" || !/^[A-Z]{3}$/.test(req.body.currency)) {
      res.status(400).json({ error: "currency must be a three-letter ISO code" });
      return;
    }
    updates.push("currency = ?");
    params.push(req.body.currency);
  }

  // The per-policy choice of which figure counts. Validated rather than
  // trusted: an unrecognised value here would read downstream as "contributes
  // nothing", which is indistinguishable from the user having turned it off.
  if ("net_worth_source" in req.body) {
    if (!NET_WORTH_SOURCES.has(req.body.net_worth_source)) {
      res.status(400).json({ error: "net_worth_source must be none, surrender or cover" });
      return;
    }
    updates.push("net_worth_source = ?");
    params.push(req.body.net_worth_source);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }

  params.push(req.params.id, req.user!.id);
  await db.prepare(`UPDATE policies SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).run(...params);

  res.json(await db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id));
});

/**
 * Records a newer statement against an existing policy.
 *
 * Appends to the history and updates the policy's current figures, rather than
 * only overwriting them — the trail is what lets a value be seen moving, and
 * what makes a misread visible by sitting next to the figure before it.
 */
policiesRouter.post("/:id/valuations", async (req, res) => {
  const existing = await db
    .prepare("SELECT * FROM policies WHERE id = ? AND user_id = ?")
    .get<PolicyRow>(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "policy not found" });
    return;
  }

  const cover = money(req.body.cover_amount ?? null, "cover_amount");
  const surrender = money(req.body.surrender_value ?? null, "surrender_value");
  if (cover === undefined || surrender === undefined) {
    res.status(400).json({ error: "a figure is outside the range a policy plausibly states" });
    return;
  }

  // The premium rides along with a statement without being part of its
  // valuation. It belongs on the policy rather than in the history — a premium
  // is what the policy costs from now on, not what it was worth on a date —
  // but it does change, and a statement is where you find out. Left out, a
  // policy whose premium escalated every year would still be telling the
  // monthly plan its opening figure.
  //
  // Optional, unlike the valuation itself: a statement that doesn't restate
  // the premium leaves the recorded one alone rather than clearing it.
  const premium = "premium" in req.body ? money(req.body.premium, "premium") : null;
  if (premium === undefined) {
    res.status(400).json({ error: "premium is outside the range a policy plausibly states" });
    return;
  }
  const frequency = req.body.premium_frequency;
  if (frequency != null && !FREQUENCIES.has(frequency)) {
    res.status(400).json({ error: "premium_frequency must be monthly, quarterly or annual" });
    return;
  }

  const valuedAt = isoDate(req.body.valued_at);
  if (valuedAt === undefined || valuedAt === null) {
    res.status(400).json({ error: "valued_at is required, as YYYY-MM-DD" });
    return;
  }

  const updated = await withTransaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO policy_valuations (id, user_id, policy_id, valued_at, cover_amount, surrender_value)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), req.user!.id, req.params.id, valuedAt, cover, surrender);

    // An older statement uploaded after a newer one updates the history but not
    // the headline figures — the card should show where the policy stands now,
    // and that is the latest valuation rather than the last one filed. The
    // premium follows the same rule for the same reason: an old statement must
    // not roll a since-escalated premium back to what it used to be.
    if (!existing.valued_at || valuedAt >= existing.valued_at) {
      const sets = ["cover_amount = ?", "surrender_value = ?", "valued_at = ?"];
      const params: unknown[] = [cover, surrender, valuedAt];
      if (premium != null) {
        sets.push("premium = ?");
        params.push(premium);
        if (frequency != null) {
          sets.push("premium_frequency = ?");
          params.push(frequency);
        }
      }
      params.push(req.params.id, req.user!.id);
      await tx.prepare(`UPDATE policies SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...params);
    }

    return tx.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  });

  res.status(201).json(updated);
});

policiesRouter.delete("/:id", async (req, res) => {
  // Valuations first: they reference the policy, so the other order fails the
  // foreign key rather than cascading.
  const removed = await withTransaction(async (tx) => {
    await tx.prepare("DELETE FROM policy_valuations WHERE policy_id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    return tx.prepare("DELETE FROM policies WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  });

  if (removed.changes === 0) {
    res.status(404).json({ error: "policy not found" });
    return;
  }
  res.status(204).send();
});

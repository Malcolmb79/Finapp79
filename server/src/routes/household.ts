import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sharesByOwner, sharesWithMember, type ShareRole } from "../auth/household.js";
import { sendEmail } from "../services/mailer.js";

/**
 * Sharing a household's finances with another person.
 *
 * Every route here deliberately uses `req.authenticatedUser` where one
 * exists, not `req.user`. The household middleware substitutes `req.user`
 * with whoever's data is being viewed, which is right for every other route
 * in the app and exactly wrong for this one: somebody looking at a partner's
 * finances must not be able to manage that partner's sharing, invite a third
 * person into it, or revoke their own way out from the inside.
 */
export const householdRouter = Router();
householdRouter.use(requireAuth);

const ROLES = new Set<ShareRole>(["viewer", "editor"]);

/** The signed-in person, never the household being viewed. */
function actor(req: { authenticatedUser?: Express.User; user?: Express.User }): Express.User {
  return (req.authenticatedUser ?? req.user)!;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

householdRouter.get("/", async (req, res) => {
  const me = actor(req);
  res.json({
    shared: await sharesByOwner(me.id),
    access: await sharesWithMember(me.id),
    viewing: req.session?.viewingUserId ?? null,
  });
});

householdRouter.post("/invite", async (req, res) => {
  const me = actor(req);
  const { email, role } = req.body as Record<string, unknown>;

  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    res.status(400).json({ error: "Give a valid email address." });
    return;
  }
  const normalised = email.trim().toLowerCase();
  if (normalised === me.email?.toLowerCase()) {
    res.status(400).json({ error: "That is your own address." });
    return;
  }
  const shareRole: ShareRole = typeof role === "string" && ROLES.has(role as ShareRole) ? (role as ShareRole) : "viewer";

  const existing = await db
    .prepare("SELECT id FROM household_shares WHERE owner_user_id = ? AND invited_email = ? AND status != 'revoked'")
    .get(me.id, normalised);
  if (existing) {
    res.status(409).json({ error: "That person has already been invited." });
    return;
  }

  // Only the hash is kept, the same rule as password resets: a database leak
  // must not become a working invite into somebody's bank data.
  const token = randomBytes(32).toString("base64url");
  await db
    .prepare(
      `INSERT INTO household_shares (id, owner_user_id, invited_email, role, status, token_hash)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .run(randomUUID(), me.id, normalised, shareRole, hashToken(token));

  const link = `${process.env.CLIENT_URL ?? "http://localhost:5173"}/household/accept?token=${token}`;
  const who = me.name ?? "Someone";
  const what = shareRole === "editor" ? "access to manage" : "a read-only view of";
  await sendEmail({
    to: normalised,
    subject: `${who} shared their finances with you`,
    text: `${who} has given you ${what} their finances.\n\nAccept here: ${link}\n\nIf you weren't expecting this, ignore it — nothing happens until you accept.`,
    html: `<p>${who} has given you ${what} their finances.</p><p><a href="${link}">Accept the invitation</a></p><p>If you weren't expecting this, ignore it — nothing happens until you accept.</p>`,
  });

  // The token is never returned to the inviter. It goes to the invited
  // address or nowhere, so an invite cannot be completed by whoever sent it.
  res.status(201).json({ ok: true });
});

householdRouter.post("/accept", async (req, res) => {
  const me = actor(req);
  const { token } = req.body as Record<string, unknown>;
  if (typeof token !== "string" || !token) {
    res.status(400).json({ error: "That invite link is missing its token." });
    return;
  }

  const share = (await db
    .prepare("SELECT id, owner_user_id, invited_email FROM household_shares WHERE token_hash = ? AND status = 'pending'")
    .get(hashToken(token))) as unknown as { id: string; owner_user_id: string; invited_email: string } | undefined;

  if (!share) {
    res.status(400).json({ error: "That invite is no longer valid." });
    return;
  }
  // The invite names an address, and only that address can take it up —
  // otherwise a forwarded email is a way into someone's finances.
  if (share.invited_email !== me.email?.toLowerCase()) {
    res.status(403).json({ error: `That invite was sent to ${share.invited_email}. Sign in as that account to accept it.` });
    return;
  }
  if (share.owner_user_id === me.id) {
    res.status(400).json({ error: "You can't share with yourself." });
    return;
  }

  // The token is cleared as it is used: single use, like every other token
  // in this app.
  await db
    .prepare("UPDATE household_shares SET member_user_id = ?, status = 'accepted', token_hash = NULL, accepted_at = ? WHERE id = ?")
    .run(me.id, new Date().toISOString(), share.id);

  res.json({ ok: true });
});

/** Either side can end a share: the owner withdraws it, the member walks away. */
householdRouter.delete("/:id", async (req, res) => {
  const me = actor(req);
  await db
    .prepare("UPDATE household_shares SET status = 'revoked', token_hash = NULL WHERE id = ? AND (owner_user_id = ? OR member_user_id = ?)")
    .run(req.params.id, me.id, me.id);

  // Someone currently looking at the household they just left should land
  // back on their own figures rather than at a blank page.
  if (req.session) req.session.viewingUserId = undefined;
  res.status(204).end();
});

/**
 * Chooses whose finances to look at.
 *
 * Stored in the session rather than sent per request, so it survives a page
 * load and cannot be set by a link somebody is sent. Nothing is trusted from
 * it either way: `resolveScope` re-checks the share on every single request.
 */
householdRouter.post("/view", async (req, res) => {
  const me = actor(req);
  const { userId } = req.body as Record<string, unknown>;

  if (userId == null || userId === me.id) {
    if (req.session) req.session.viewingUserId = undefined;
    res.json({ viewing: null });
    return;
  }
  if (typeof userId !== "string") {
    res.status(400).json({ error: "Say whose finances to view." });
    return;
  }

  const allowed = (await sharesWithMember(me.id)).some((share) => share.owner_user_id === userId);
  if (!allowed) {
    res.status(403).json({ error: "You don't have access to those finances." });
    return;
  }

  if (req.session) req.session.viewingUserId = userId;
  res.json({ viewing: userId });
});

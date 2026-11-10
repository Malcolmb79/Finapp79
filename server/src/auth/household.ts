import { db } from "../db/client.js";

/**
 * Who is allowed to look at whose finances.
 *
 * This is the most dangerous file in the app. Every table here carries a
 * `user_id` and every query filters on it, so the single question "which user
 * id do the queries run as" decides whether one household's bank data appears
 * in another's browser. Getting it wrong is not a bug that shows up as a
 * glitch — it shows up as somebody else's salary on your dashboard.
 *
 * So the decision lives here, in one function, rather than being spread
 * across the route files as a parameter each of them has to remember. The
 * routes were already written to scope by `req.user!.id` and still are; what
 * changes is only what that id *is*, once, before any route runs.
 */

export type ShareRole = "viewer" | "editor";

export interface Share {
  id: string;
  owner_user_id: string;
  member_user_id: string | null;
  invited_email: string;
  role: ShareRole;
  status: string;
}

export interface Scope {
  /** The user id every query should run as. */
  userId: string;
  /** True when this is somebody else's data, which the UI has to say. */
  borrowed: boolean;
  /** Set only when borrowed — what may be done with it. */
  role?: ShareRole;
  /** The owner's name, for saying whose finances are on screen. */
  ownerName?: string;
}

/**
 * Resolves which user's data a request should see.
 *
 * `viewing` is whatever the session asked to look at. It is never trusted:
 * the only thing that grants access is an accepted, unrevoked share row
 * naming this exact pair, and anything else falls back to the signed-in
 * user's own data rather than erroring. Falling back rather than failing is
 * deliberate — a revoked share should quietly return someone to their own
 * finances, not lock them out of an app they still own.
 */
export async function resolveScope(authenticatedUserId: string, viewing: string | undefined): Promise<Scope> {
  const own: Scope = { userId: authenticatedUserId, borrowed: false };
  if (!viewing || viewing === authenticatedUserId) return own;

  const share = (await db
    .prepare(
      `SELECT s.role, u.name AS owner_name
         FROM household_shares s
         JOIN users u ON u.id = s.owner_user_id
        WHERE s.owner_user_id = ?
          AND s.member_user_id = ?
          AND s.status = 'accepted'`
    )
    .get(viewing, authenticatedUserId)) as unknown as { role: ShareRole; owner_name: string | null } | undefined;

  if (!share) return own;

  return { userId: viewing, borrowed: true, role: share.role, ownerName: share.owner_name ?? "someone" };
}

/** Everyone this user has shared their finances with. */
export async function sharesByOwner(ownerUserId: string): Promise<Share[]> {
  return (await db
    .prepare(
      `SELECT id, owner_user_id, member_user_id, invited_email, role, status
         FROM household_shares WHERE owner_user_id = ? AND status != 'revoked' ORDER BY created_at`
    )
    .all(ownerUserId)) as unknown as Share[];
}

/** Everyone whose finances this user can look at. */
export async function sharesWithMember(memberUserId: string): Promise<{ owner_user_id: string; owner_name: string; role: ShareRole }[]> {
  return (await db
    .prepare(
      `SELECT s.owner_user_id, COALESCE(u.name, u.email) AS owner_name, s.role
         FROM household_shares s
         JOIN users u ON u.id = s.owner_user_id
        WHERE s.member_user_id = ? AND s.status = 'accepted'
        ORDER BY owner_name`
    )
    .all(memberUserId)) as unknown as { owner_user_id: string; owner_name: string; role: ShareRole }[];
}

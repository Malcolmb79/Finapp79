import type { NextFunction, Request, Response } from "express";
import { resolveScope } from "../auth/household.js";

/**
 * Points the request at the right person's data, once.
 *
 * Every route in this app scopes its queries by `req.user!.id`. Rather than
 * thread a second "and whose data?" parameter through fifteen route files —
 * fifteen places to forget it, each forgetting leaking a household's finances
 * — this substitutes the id itself, before any route runs, and only when an
 * accepted share says it may.
 *
 * `req.authenticatedUser` keeps the real identity, because the substitution
 * must not be able to hide who is actually signed in.
 *
 * A viewer is enforced here too, for the same reason: a read-only share that
 * depended on every route checking a role would be read-only until one route
 * forgot. Anything that is not a GET is refused outright while borrowing, so
 * a route added next year is read-only by default rather than by diligence.
 */
declare module "express-serve-static-core" {
  interface Request {
    /** The signed-in person, before any household substitution. */
    authenticatedUser?: Express.User;
    /** Set when viewing someone else's finances. */
    household?: { ownerName: string; role: string };
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function householdScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  /**
   * Sharing itself is never viewed as somebody else.
   *
   * These routes are about the signed-in person's own relationships, not the
   * finances they happen to be looking at. Substituting here would mean a
   * viewer could manage the owner's sharing — and, found by trying it, that
   * a viewer could not end their own share while viewing it, because the
   * DELETE was refused as a write to the owner's data before the route that
   * would have handled it ever ran.
   */
  if (req.path.startsWith("/api/household")) {
    next();
    return;
  }

  const viewing = req.session?.viewingUserId;
  const scope = await resolveScope(req.user.id, viewing);

  if (!scope.borrowed) {
    next();
    return;
  }

  if (scope.role === "viewer" && !SAFE_METHODS.has(req.method)) {
    res.status(403).json({ error: `You can view ${scope.ownerName}'s finances but not change them.` });
    return;
  }

  req.authenticatedUser = req.user;
  // The substitution itself. Everything downstream — every route, every
  // query — now runs as the owner, which is the whole mechanism.
  req.user = { ...req.user, id: scope.userId };
  req.household = { ownerName: scope.ownerName ?? "someone", role: scope.role ?? "viewer" };
  next();
}

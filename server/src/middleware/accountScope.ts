import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The single account the client is currently looking at, or null for all
       * of them. Set from the X-Account-Scope header the client sends on every
       * request.
       */
      accountScope?: string | null;
    }
  }
}

/**
 * Carries the client's account filter through to the queries that answer it.
 *
 * The advisers have to reason over the same accounts the screen is showing.
 * One that quietly included accounts the user had filtered out would produce
 * advice they cannot reconcile with anything in front of them — a payoff plan
 * citing a balance that appears nowhere on the page.
 *
 * This only ever narrows, and always within the user's own rows: the id is
 * matched against accounts already filtered by user_id, so a forged header can
 * reach nothing it couldn't reach without one.
 */
export function accountScope(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get("X-Account-Scope");
  req.accountScope = header && header.trim() ? header.trim() : null;
  next();
}

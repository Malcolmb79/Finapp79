import { describe, expect, it, vi } from "vitest";
import { householdScope } from "./householdScope.js";

vi.mock("../auth/household.js", () => ({
  resolveScope: vi.fn(),
}));

const { resolveScope } = await import("../auth/household.js");
const mocked = vi.mocked(resolveScope);

function run(
  scope: Awaited<ReturnType<typeof resolveScope>>,
  { method = "GET", viewing = "owner", path = "/api/accounts" }: { method?: string; viewing?: string; path?: string } = {}
) {
  mocked.mockResolvedValue(scope);
  const req = { user: { id: "me", email: "me@example.test" }, session: { viewingUserId: viewing }, method, path } as never as Parameters<
    typeof householdScope
  >[0];
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as never as Parameters<typeof householdScope>[1];
  const next = vi.fn();
  return { req, res, next, sent, done: householdScope(req, res, next) };
}

/**
 * The most dangerous decision in the app: every query scopes by the id this
 * sets, so a mistake here does not show up as a glitch — it shows up as
 * somebody else's salary on your dashboard.
 */
describe("householdScope", () => {
  it("leaves a request on its own data when nothing is shared", async () => {
    const t = run({ userId: "me", borrowed: false });
    await t.done;
    expect(t.req.user!.id).toBe("me");
    expect(t.req.household).toBeUndefined();
    expect(t.next).toHaveBeenCalled();
  });

  it("substitutes the owner's id when a share allows it", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "editor", ownerName: "Sam" });
    await t.done;
    expect(t.req.user!.id).toBe("owner");
    expect(t.req.household).toEqual({ ownerName: "Sam", role: "editor" });
    expect(t.next).toHaveBeenCalled();
  });

  // The substitution must never hide who is actually signed in.
  it("keeps the real identity alongside", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "editor", ownerName: "Sam" });
    await t.done;
    expect(t.req.authenticatedUser!.id).toBe("me");
  });

  // Read-only enforced here rather than per route, so a route added next year
  // is read-only by default rather than by somebody remembering.
  it("refuses a write while viewing as a viewer", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const t = run({ userId: "owner", borrowed: true, role: "viewer", ownerName: "Sam" }, { method });
      await t.done;
      expect(t.sent.status, method).toBe(403);
      expect(t.next, method).not.toHaveBeenCalled();
    }
  });

  it("allows reads for a viewer", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "viewer", ownerName: "Sam" }, { method: "GET" });
    await t.done;
    expect(t.next).toHaveBeenCalled();
    expect(t.req.user!.id).toBe("owner");
  });

  it("lets an editor write", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "editor", ownerName: "Sam" }, { method: "POST" });
    await t.done;
    expect(t.next).toHaveBeenCalled();
  });

  it("does nothing for an unauthenticated request", async () => {
    const req = { session: {}, method: "GET", path: "/api/accounts" } as never as Parameters<typeof householdScope>[0];
    const next = vi.fn();
    await householdScope(req, {} as never, next);
    expect(next).toHaveBeenCalled();
  });
});

/**
 * Sharing is managed as yourself, never as the household you are looking at.
 *
 * Found by trying it: a viewer could not end their own share while viewing
 * it, because the DELETE was refused as a write to the owner's data before
 * the route that would have handled it ever ran.
 */
describe("the household routes themselves", () => {
  it("are never viewed as somebody else", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "viewer", ownerName: "Sam" }, { method: "DELETE", path: "/api/household/abc" });
    await t.done;
    expect(t.next).toHaveBeenCalled();
    expect(t.sent.status).toBeUndefined();
    // Still the signed-in person, so household.ts manages their relationships.
    expect(t.req.user!.id).toBe("me");
  });

  it("let a viewer leave a share they are currently looking at", async () => {
    const t = run({ userId: "owner", borrowed: true, role: "viewer", ownerName: "Sam" }, { method: "DELETE", path: "/api/household/abc" });
    await t.done;
    expect(t.sent.status).not.toBe(403);
  });
});

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Category } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";

/**
 * Adding categories, by hand or from a starter set.
 *
 * The starter set exists because the only other source of categories was the
 * AI categoriser, which runs while importing a statement — so an account that
 * had never imported anything had no way to get a first category at all, and
 * the feature that could have given it one is the same one that goes quiet
 * when no API key is configured.
 *
 * Nothing is written until the selection is confirmed, the same as every
 * other suggestion in this app. The list is offered with everything ticked,
 * because the common case is wanting most of it.
 */
export default function CategoryManager({
  categories,
  onCreated,
  onSelect,
}: {
  categories: Category[];
  onCreated: () => void;
  /** Opens this category in the breakdown card, where one is on the page. */
  onSelect?: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [marking, setMarking] = useState<number | null>(null);
  const [starter, setStarter] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showStarter, setShowStarter] = useState(false);
  const [hasAny, setHasAny] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .starterCategories()
      .then((r) => {
        setStarter(r.suggestions);
        setHasAny(r.hasAny);
        // Offered up front only when there are none at all — otherwise it is
        // there if wanted but not in the way.
        setShowStarter(!r.hasAny && r.suggestions.length > 0);
        setChosen(new Set(r.suggestions));
      })
      .catch(() => setStarter([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createCategory(name.trim());
    setName("");
    onCreated();
  }

  async function addChosen() {
    setBusy(true);
    setStatus(null);
    try {
      // Sequential rather than parallel: the create route resolves an
      // existing name to the existing row, and two racing requests for the
      // same name would both miss it and race the unique index instead.
      for (const category of starter.filter((c) => chosen.has(c))) {
        await api.createCategory(category);
      }
      const remaining = await api.starterCategories();
      setStarter(remaining.suggestions);
      setChosen(new Set(remaining.suggestions));
      setShowStarter(false);
      setHasAny(true);
      onCreated();
    } catch (err) {
      setStatus(errorMessage(err, "Couldn't add those categories."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marks a category as regular income.
   *
   * The balance projection otherwise waits to be convinced: it finds income
   * by pattern, needing three credits of a consistent amount before it
   * believes in a salary. Someone who has just started a job, changed
   * employer, or is paid from more than one place gets a line that only ever
   * falls, and no way to say otherwise. This is the way to say it.
   */
  /**
   * What a category is to the forecast, as one of three states.
   *
   * One control rather than two checkboxes, because the three states are a
   * single question - what kind of money is this - and two tickboxes would
   * also offer "occasional, but not income", which means nothing.
   */
  const incomeState = (c: Category): "none" | "regular" | "occasional" | "transfer" =>
    c.is_transfer ? "transfer" : !c.counts_as_income ? "none" : c.income_is_occasional ? "occasional" : "regular";

  const NEXT = {
    none: {
      patch: { counts_as_income: true },
      label: "Mark as income",
      title: "Treat money filed here as regular income, so the balance projection counts on it",
    },
    regular: {
      patch: { income_is_occasional: true },
      label: "Make occasional",
      title: "Income that turns up on no schedule, like a tax refund or a bonus. Counted in every total, and kept out of the balance projection so it is not drawn forward as a monthly payment",
    },
    occasional: {
      patch: { is_transfer: true },
      label: "Make a transfer",
      title:
        "Money moving between your own accounts. One move is two rows, so counting them would report income and spending that never happened - these are kept out of every income, spending and savings-rate figure, while the balances they affect stay right",
    },
    transfer: {
      patch: { is_transfer: false },
      label: "Unset",
      title: "Stop treating money filed here as a movement between your own accounts",
    },
  } as const;

  async function toggleIncome(category: Category) {
    setMarking(category.id);
    setStatus(null);
    try {
      await api.updateCategory(category.id, NEXT[incomeState(category)].patch);
      onCreated();
    } catch (err) {
      setStatus(errorMessage(err, "Couldn't change that category."));
    } finally {
      setMarking(null);
    }
  }

  /**
   * Whether this category holds subscriptions.
   *
   * A separate control from the income cycle above, because it answers a
   * different question. That one asks what kind of *money* this is — income,
   * occasional income, or a movement between your own accounts. This asks
   * what kind of *spending* it is, and the two do not interact: there is no
   * combination of them to resolve.
   *
   * It is the only thing that decides what the Subscriptions page lists. The
   * detector that used to decide found a personal loan, a life policy and a
   * phone bill, because all three charge monthly for a consistent amount —
   * which is what a standing commitment is, and is not what a subscription
   * is. Only the filing holds that difference.
   */
  async function toggleSubscription(category: Category) {
    setMarking(category.id);
    setStatus(null);
    try {
      await api.updateCategory(category.id, { is_subscription: !category.is_subscription });
      onCreated();
    } catch (err) {
      setStatus(errorMessage(err, "Couldn't change that category."));
    } finally {
      setMarking(null);
    }
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Add category</button>
        {starter.length > 0 && !showStarter && (
          <button type="button" onClick={() => setShowStarter(true)}>
            <Sparkles size={13} /> {hasAny ? "Suggest more" : "Suggest a starter set"}
          </button>
        )}
      </form>

      {showStarter && (
        <div style={{ marginTop: "0.7rem", border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem" }}>
          <p style={{ fontSize: "0.82rem", margin: "0 0 0.5rem" }}>
            {hasAny
              ? "Some everyday categories you don't have yet. Untick anything you don't want."
              : "You have no categories yet. These are broad everyday ones meant to be reused across many transactions — untick anything you don't want."}
          </p>

          {/* Bounded and scrollable, so the confirm buttons below stay in
              view. Unbounded, fourteen wrapped checkboxes pushed them past
              the bottom of the card — the action was reachable only by
              scrolling inside a panel that gave no sign there was more. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem 0.9rem",
              marginBottom: "0.7rem",
              maxHeight: 132,
              overflowY: "auto",
            }}
          >
            {starter.map((category) => (
              <label key={category} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={chosen.has(category)}
                  onChange={(e) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(category);
                      else next.delete(category);
                      return next;
                    })
                  }
                />
                {category}
              </label>
            ))}
          </div>

          {/* Stuck to the bottom of the card's scrolling area. The card is
              260–330px tall and this panel is ~390, so the buttons sat below
              the fold: reachable by scrolling inside the card, but with
              nothing to suggest there was anything down there. Sticky keeps
              them in view at any card size, which beats sizing the card for
              its largest moment and leaving it half empty the rest of the
              time. */}
          <div
            style={{
              display: "flex",
              gap: "0.4rem",
              alignItems: "center",
              position: "sticky",
              bottom: 0,
              background: "var(--card-plane, var(--page-plane))",
              paddingTop: "0.4rem",
            }}
          >
            <button type="button" className="btn-accent" onClick={addChosen} disabled={busy || chosen.size === 0}>
              {busy ? <Loader2 size={13} className="spin" /> : null}
              Add {chosen.size} {chosen.size === 1 ? "category" : "categories"}
            </button>
            <button type="button" onClick={() => setShowStarter(false)} disabled={busy}>
              Not now
            </button>
          </div>

          {status && <p style={{ fontSize: "0.8rem", color: "var(--critical)", margin: "0.5rem 0 0" }}>{status}</p>}
        </div>
      )}

      {/* The categories themselves, with the one thing worth setting on them.
          Listing them here also means the card finally shows what you have
          rather than only offering to add more. */}
      {categories.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <p className="stat-tile__label" style={{ marginBottom: "0.3rem" }}>
            Your categories
          </p>
          <div style={{ display: "grid", gap: "0.15rem" }}>
            {categories.map((category) => (
              <div
                key={category.id}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", padding: "0.1rem 0" }}
              >
                {/* The name is the way into the breakdown where there is one
                    on the page. A plain span otherwise, rather than something
                    that looks clickable and does nothing. */}
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(category.id)}
                    title={`See what ${category.name} is made of`}
                    className="category-row__name"
                  >
                    {category.name}
                  </button>
                ) : (
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {category.name}
                  </span>
                )}
                {incomeState(category) !== "none" && (
                  <span
                    style={{
                      fontSize: "0.68rem",
                      whiteSpace: "nowrap",
                      // Occasional income is real income, so it is not greyed
                      // out - but it is not something to plan around either,
                      // and the warmer colour says which of the two it is.
                      color:
                        incomeState(category) === "transfer"
                          ? "var(--accent-2)"
                          : incomeState(category) === "occasional"
                            ? "var(--warning)"
                            : "var(--good)",
                    }}
                  >
                    {incomeState(category) === "transfer"
                      ? "transfer, not income"
                      : incomeState(category) === "occasional"
                        ? "occasional income"
                        : "regular income"}
                  </span>
                )}
                {/* Offered only on spending categories. A salary or a
                    transfer holding subscriptions is not a state worth
                    being able to create. */}
                {incomeState(category) === "none" && (
                  <button
                    type="button"
                    onClick={() => toggleSubscription(category)}
                    disabled={marking === category.id}
                    title={
                      category.is_subscription
                        ? `Stop listing what is filed under ${category.name} on the Subscriptions page`
                        : `List what is filed under ${category.name} on the Subscriptions page. Nothing else decides what counts as a subscription`
                    }
                    className={category.is_subscription ? "category-row__tag category-row__tag--on" : "category-row__tag"}
                  >
                    {category.is_subscription ? "subscriptions ✓" : "subscriptions"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleIncome(category)}
                  disabled={marking === category.id}
                  title={NEXT[incomeState(category)].title}
                  style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", background: "transparent", whiteSpace: "nowrap" }}
                >
                  {marking === category.id ? <Loader2 size={11} className="spin" /> : NEXT[incomeState(category)].label}
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
            Money filed under a category marked as income is counted on by the balance projection straight away, instead
            of it waiting to spot three matching payments.
          </p>
        </div>
      )}
    </div>
  );
}

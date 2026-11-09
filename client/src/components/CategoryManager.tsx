import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
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
export default function CategoryManager({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
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
    </div>
  );
}

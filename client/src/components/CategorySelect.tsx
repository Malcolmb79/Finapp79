import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Category } from "../api/client.js";

/**
 * A category picker that filters as you type.
 *
 * A plain <select> stops being usable once there are more than a dozen
 * categories — on a phone it becomes a scroll wheel with no way to jump to
 * what you want. This keeps the same footprint but opens a searchable list,
 * and optionally offers to create the name you typed when nothing matches.
 *
 * The list is positioned fixed, anchored to the trigger's rect, so it escapes
 * the scrolling containers it gets used inside (the import dialog's row list
 * clips anything absolutely positioned within it).
 */
export default function CategorySelect({
  categories,
  value,
  onChange,
  onCreate,
  placeholder = "Uncategorized",
  width = 150,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  /** Enables creating the typed name when it matches nothing. */
  onCreate?: (name: string) => Promise<Category | undefined | void>;
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selected = categories.find((c) => c.id === value) ?? null;
  const needle = query.trim().toLowerCase();
  const matches = needle ? categories.filter((c) => c.name.toLowerCase().includes(needle)) : categories;
  // Only offer creation when the typed name isn't already a category —
  // otherwise the picker invites making the duplicate it's meant to prevent.
  const exact = categories.some((c) => c.name.toLowerCase() === needle);
  const canCreate = !!onCreate && needle.length > 0 && !exact;

  useLayoutEffect(() => {
    if (open) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    // Repositioning on scroll would be wrong here: the trigger can scroll out
    // of view inside a list, so closing is the honest behaviour.
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  function pick(id: number | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  async function create() {
    if (!onCreate) return;
    const created = await onCreate(query.trim());
    if (created && typeof created === "object" && "id" in created) onChange(created.id);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selected?.name ?? placeholder}
        style={{
          width,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.3rem",
          fontSize: "0.82rem",
          padding: "0.3rem 0.45rem",
          color: selected ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown size={13} style={{ flexShrink: 0 }} />
      </button>

      {open && rect && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            zIndex: 80,
            // Flips above the trigger when there isn't room below.
            top: rect.bottom + 260 > window.innerHeight ? undefined : rect.bottom + 4,
            bottom: rect.bottom + 260 > window.innerHeight ? window.innerHeight - rect.top + 4 : undefined,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(width, 220) - 8)),
            width: Math.max(width, 220),
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              autoFocus
              value={query}
              placeholder="Search categories"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter") {
                  if (matches.length > 0) pick(matches[0].id);
                  else if (canCreate) create();
                }
              }}
              style={{ flex: 1, border: "none", background: "transparent", fontSize: "0.82rem", padding: 0 }}
            />
          </div>

          <div style={{ maxHeight: 200, overflow: "auto" }}>
            <button type="button" className="add-widget-menu__item" onClick={() => pick(null)} style={{ width: "100%", fontSize: "0.82rem" }}>
              {value == null && <Check size={12} />}
              {placeholder}
            </button>
            {matches.map((c) => (
              <button
                type="button"
                key={c.id}
                className="add-widget-menu__item"
                onClick={() => pick(c.id)}
                style={{ width: "100%", fontSize: "0.82rem" }}
              >
                {c.id === value && <Check size={12} />}
                {c.name}
              </button>
            ))}
            {matches.length === 0 && !canCreate && (
              <p className="empty-state" style={{ padding: "0.5rem" }}>
                No matching categories.
              </p>
            )}
            {canCreate && (
              <button type="button" className="add-widget-menu__item" onClick={create} style={{ width: "100%", fontSize: "0.82rem", fontWeight: 600 }}>
                <Plus size={12} />
                Create “{query.trim()}”
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

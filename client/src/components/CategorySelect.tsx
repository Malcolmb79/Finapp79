import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
/**
 * The matched part of a name, picked out.
 *
 * Filtering that only removes rows leaves the reader to work out *why* each
 * survivor is there. Marking the matched run answers it at a glance, which
 * matters most on the small screen where only a few rows are visible.
 */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark style={{ background: "var(--seq-100)", color: "inherit", borderRadius: 2, padding: "0 1px" }}>
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

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

  /**
   * The area actually visible, which is not the window on a phone.
   *
   * An on-screen keyboard doesn't change window.innerHeight — it covers the
   * bottom of it. Positioning against the window therefore put the list where
   * the keyboard now is, and the "flip above when there's no room below" rule
   * fired on a height that no longer existed, throwing the list off the top of
   * the screen instead. visualViewport is the part the user can see.
   */
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
  }));

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const update = () =>
      setViewport({
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
        offsetTop: vv?.offsetTop ?? 0,
      });
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    // Follow the trigger rather than closing. Closing on any scroll made the
    // list unusable on touch: tapping an option produces a small scroll
    // (momentum, rubber-banding, the keyboard settling), which closed the
    // popover before the tap resolved — so only typing a name out in full and
    // pressing Enter ever selected anything.
    const reposition = () => setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
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

  /**
   * On a phone the picker takes the whole screen, with the search at the top.
   *
   * It used to open as a sheet pinned to the bottom of the visual viewport,
   * which is right in principle and wrong on iOS: the keyboard's accessory
   * bar — the prev/next/done strip — sits above the keyboard and is *not*
   * inside visualViewport. So the sheet was laid exactly underneath it, and
   * the filtered list was invisible behind a grey bar while somebody typed.
   *
   * Anchoring to the top instead sidesteps the whole measurement problem.
   * The keyboard can cover as much of the bottom as it likes; the search
   * field and the first several results are above it either way, and the list
   * simply scrolls. Nothing has to be measured, so nothing can be measured
   * wrong on a browser that reports its chrome differently.
   */
  const asSheet = viewport.width < 560;
  const viewportBottom = viewport.offsetTop + viewport.height;
  const spaceBelow = rect ? viewportBottom - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - viewport.offsetTop - 8 : 0;
  const dropUp = !asSheet && !!rect && spaceBelow < 220 && spaceAbove > spaceBelow;

  const placement: CSSProperties = asSheet
    ? {
        top: viewport.offsetTop,
        left: 0,
        right: 0,
        height: viewport.height,
        maxHeight: viewport.height,
        borderRadius: 0,
      }
    : {
        top: dropUp ? undefined : (rect?.bottom ?? 0) + 4,
        bottom: dropUp ? window.innerHeight - (rect?.top ?? 0) + 4 : undefined,
        left: Math.max(8, Math.min(rect?.left ?? 0, viewport.width - Math.max(width, 220) - 8)),
        width: Math.max(width, 220),
        // Never taller than the room it actually has, so the list scrolls
        // rather than running off an edge.
        maxHeight: Math.max(160, (dropUp ? spaceAbove : spaceBelow) - 8),
      };

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

      {/* A scrim on the phone, so the dialog underneath stops showing
          through a list laid over it. Without one the two sets of rows
          overlapped and the whole thing read as a mess rather than as a
          picker. Tapping it closes, which is what a sheet should do. */}
      {open && rect && asSheet && (
        <div
          onPointerDown={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 79, background: "rgba(0, 0, 0, 0.45)" }}
        />
      )}

      {open && rect && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            zIndex: 80,
            ...placement,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: asSheet ? "0.7rem 0.75rem" : "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
            <Search size={asSheet ? 15 : 13} color="var(--text-muted)" />
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
              style={{ flex: 1, border: "none", background: "transparent", fontSize: asSheet ? "1rem" : "0.82rem", padding: 0, minWidth: 0 }}
            />
            {asSheet && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                }}
                style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem", flexShrink: 0 }}
              >
                Close
              </button>
            )}
          </div>

          {/* What it is filtering to, said out loud. A list that silently
              shortened as somebody typed gave no way to tell "no matches"
              apart from "the list is scrolled" — which is the complaint that
              prompted this. */}
          {needle.length > 0 && (
            <p
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                margin: 0,
                padding: "0.3rem 0.75rem",
                borderBottom: "1px solid var(--gridline)",
              }}
            >
              {matches.length === 0
                ? `Nothing matches "${query.trim()}"`
                : `${matches.length} of ${categories.length} ${categories.length === 1 ? "category" : "categories"} match "${query.trim()}"`}
            </p>
          )}

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {/* Selecting on pointerdown, not click: the search input holds
                focus, and on touch the blur/scroll that follows a tap could
                tear the popover down before a click ever landed. */}
            <button
              type="button"
              className="add-widget-menu__item"
              onPointerDown={(e) => {
                e.preventDefault();
                pick(null);
              }}
              style={{ width: "100%", fontSize: "0.82rem" }}
            >
              {value == null && <Check size={12} />}
              {placeholder}
            </button>
            {matches.map((c) => (
              <button
                type="button"
                key={c.id}
                className="add-widget-menu__item"
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(c.id);
                }}
                style={{ width: "100%", fontSize: asSheet ? "0.95rem" : "0.82rem", padding: asSheet ? "0.6rem 0.75rem" : undefined }}
              >
                {c.id === value && <Check size={12} />}
                <Highlighted text={c.name} needle={needle} />
              </button>
            ))}
            {matches.length === 0 && !canCreate && (
              <p className="empty-state" style={{ padding: "0.5rem" }}>
                No matching categories.
              </p>
            )}
            {canCreate && (
              <button
                type="button"
                className="add-widget-menu__item"
                onPointerDown={(e) => {
                  e.preventDefault();
                  create();
                }}
                style={{ width: "100%", fontSize: "0.82rem", fontWeight: 600 }}
              >
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

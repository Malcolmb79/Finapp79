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

  // Below this a floating list anchored to a control has nowhere to go once
  // the keyboard is up, so it becomes a sheet at the bottom of what's visible
  // — full width, above the keyboard, which is where a phone expects it.
  const asSheet = viewport.width < 560;
  const viewportBottom = viewport.offsetTop + viewport.height;
  const spaceBelow = rect ? viewportBottom - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - viewport.offsetTop - 8 : 0;
  const dropUp = !!rect && spaceBelow < 220 && spaceAbove > spaceBelow;

  const placement: CSSProperties = asSheet
    ? {
        left: 8,
        right: 8,
        // The gap the keyboard occupies: fixed positioning measures from the
        // window, so the sheet has to be lifted clear of it explicitly.
        bottom: Math.max(8, window.innerHeight - viewportBottom + 8),
        maxHeight: Math.max(180, viewport.height * 0.6),
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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * The actions on a row, behind one button.
 *
 * An account row carried seven controls, five of them icons with no label —
 * an eraser, a clock, an eye, a bin. On a desktop that is a cluttered row;
 * on a phone it was two wrapped lines of buttons per account, taller than the
 * account itself, and the icons were a guess apiece. Fourteen accounts made
 * it ninety-eight buttons on one screen.
 *
 * Collapsed, each one gets its name back. That is the real gain and not the
 * space: "Clear transactions" and "Import history" are two words each and
 * were being conveyed by an eraser and a clock, which are the same picture to
 * anybody who has not used this page before.
 *
 * What stays outside is a judgement about use, not about importance: the one
 * action somebody came to the page to perform stays on the row, and the rest
 * are things done once or rarely.
 */

export interface RowMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Reads in the warning colour — removing an account, clearing its history. */
  danger?: boolean;
}

/** Must match `.row-menu`'s width, since the side is chosen from it. */
const MENU_WIDTH = 208;
const EDGE = 8;

export default function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  /**
   * Which edge of the button the menu hangs from.
   *
   * Neither side is right on its own: this button sits a third of the way
   * along the row on a phone and at the far end of it on a desktop, so a menu
   * fixed to the left runs off one screen and one fixed to the right runs off
   * the other. Decided when it opens, from where the button actually is.
   */
  const [fromRight, setFromRight] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /**
   * Escape closes it, because a menu opened by accident on a touch screen is
   * opened by accident often, and the backdrop below is invisible — there is
   * nothing on screen saying "tap here to get out of this".
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        onClick={() => {
          const edge = box.current?.getBoundingClientRect().left ?? 0;
          setFromRight(edge + MENU_WIDTH > window.innerWidth - EDGE);
          setOpen((was) => !was);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        title={label}
      >
        <MoreHorizontal size={15} color="var(--text-muted)" />
      </button>
      {open && (
        <>
          {/* A full-screen catcher rather than a document listener: it closes
              on the same tap that does anything else, and it cannot miss a
              click that landed on something with its own handler. */}
          <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
          {/* Hangs from whichever edge keeps it on the screen — see
              `fromRight`. The shared menu style hangs from the right, which
              is correct for a control in the top corner of the page and wrong
              for one a third of the way along a row. */}
          <div
            className="add-widget-menu row-menu"
            role="menu"
            style={fromRight ? { left: "auto", right: 0 } : undefined}
          >
            {items.map((item) => (
              <button
                key={item.key}
                role="menuitem"
                className="add-widget-menu__item"
                disabled={item.disabled}
                style={item.danger ? { color: "var(--critical)" } : undefined}
                onClick={() => {
                  // Closed first, so an action that opens something of its own
                  // — a file picker, a confirmation on the row — is not left
                  // underneath a menu still sitting over the top of it.
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

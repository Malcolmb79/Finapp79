import { Check, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Note } from "../../api/client.js";

/**
 * The things somebody means to do about their money.
 *
 * Not a task manager, and the restraint is the point. "Cancel the gym",
 * "chase the deposit", "move 500 before the 28th" are the one part of a
 * monthly review with nowhere to live — they end up in a phone note that is
 * never beside the figures that prompted them, and so never get done.
 *
 * Done items stay until cleared rather than vanishing on the tick, because a
 * list that empties itself gives no sense of having got through anything —
 * and because an accidental tick with no undo is worse than a slightly longer
 * list.
 */

export default function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .listNotes()
      .then(setNotes)
      .catch(() => setNotes([]));
  }, []);

  useEffect(refresh, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await api.createNote(body);
      // Prepended rather than refetched: the list is already correct and a
      // round trip here would make the field feel slow on the one action
      // somebody repeats.
      setNotes((current) => [created, ...current]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(note: Note) {
    const done = note.done_at === null;
    setNotes((current) =>
      current.map((n) => (n.id === note.id ? { ...n, done_at: done ? new Date().toISOString() : null } : n))
    );
    await api.updateNote(note.id, { done });
    refresh();
  }

  async function remove(note: Note) {
    setNotes((current) => current.filter((n) => n.id !== note.id));
    await api.deleteNote(note.id);
  }

  const outstanding = notes.filter((n) => n.done_at === null);
  const done = notes.filter((n) => n.done_at !== null);

  return (
    <>
      <form onSubmit={add} className="notes-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Something to do about it…"
          maxLength={500}
          aria-label="New note"
        />
        <button type="submit" disabled={!draft.trim() || busy} className="btn-accent" aria-label="Add note">
          <Plus size={13} />
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="empty-state" style={{ marginTop: "0.6rem" }}>
          Nothing noted. A review that produces no actions was a nice read and nothing more.
        </p>
      ) : (
        <ul className="notes-list">
          {[...outstanding, ...done].map((note) => (
            <li key={note.id} data-done={note.done_at ? "true" : undefined}>
              <button
                className="notes-tick"
                onClick={() => toggle(note)}
                aria-label={note.done_at ? `Mark "${note.body}" as still to do` : `Mark "${note.body}" done`}
                aria-pressed={note.done_at !== null}
              >
                {note.done_at && <Check size={11} />}
              </button>
              <span>{note.body}</span>
              <button className="notes-remove" onClick={() => remove(note)} aria-label={`Delete "${note.body}"`}>
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <button
          className="btl-toggle"
          onClick={async () => {
            await api.clearDoneNotes();
            refresh();
          }}
        >
          Clear {done.length} done
        </button>
      )}
    </>
  );
}

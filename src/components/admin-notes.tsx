import { addNote } from "@/app/admin/actions";
import { Submit } from "./submit";

/** Заметка админа (admin_notes). */
export type AdminNote = { id: string; created_at: string; body: string; next_contact: string | null; author_email: string | null };

const day = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

/** Заметки о магазине или человеке и дата «связаться снова» (попадает в «Связаться»). */
export function AdminNotes({ notes, org, user }: { notes: AdminNote[]; org?: string; user?: string }) {
  return (
    <section className="adm-card" id="notes">
      <h2>Заметки</h2>
      <form action={addNote} className="adm-note-form">
        {org && <input type="hidden" name="org" value={org} />}
        {user && <input type="hidden" name="user" value={user} />}
        <textarea name="body" required maxLength={2000} rows={3} placeholder="Что обсудили, что обещали" aria-label="Заметка" />
        <div className="adm-note-row">
          <label>
            Связаться снова
            <input name="next_contact" type="date" />
          </label>
          <Submit>Сохранить</Submit>
        </div>
      </form>
      {notes.length > 0 && (
        <ul className="adm-notes">
          {notes.map((n) => (
            <li key={n.id}>
              {n.body}
              <small>
                {day(n.created_at)}
                {n.author_email ? ` · ${n.author_email}` : ""}
                {n.next_contact ? ` · связаться ${day(`${n.next_contact}T12:00:00Z`)}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

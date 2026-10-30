/**
 * Пустой раздел нового магазина (isNewShop, просьба пользователя 29.10.2026):
 * зачем он, бледный пример, как он будет выглядеть, и куда нажать. Пример —
 * картинка из текста, не данные магазина: не нажимается, в базу и отчёты не
 * попадает. Появилась первая настоящая запись — раздел обычный.
 */
export type ExampleRow = { name: string; note?: string; value?: React.ReactNode };

export function Teach({
  title,
  text,
  steps,
  rows,
  message,
  children,
}: {
  title: string;
  text: React.ReactNode;
  /** Шаги «куда нажать» по порядку. */
  steps?: readonly string[];
  rows: readonly ExampleRow[];
  /** Пример сообщения клиенту под строками (напоминание в WhatsApp). */
  message?: string;
  /** Настоящие кнопки раздела. */
  children?: React.ReactNode;
}) {
  return (
    <div className="teach">
      <h2>{title}</h2>
      <p>{text}</p>
      {steps && <TeachSteps steps={steps} />}
      <TeachExample rows={rows} message={message} />
      {children && <div className="teach-actions">{children}</div>}
    </div>
  );
}

export function TeachSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="teach-steps">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

export function TeachExample({ rows, message }: { rows: readonly ExampleRow[]; message?: string }) {
  return (
    <div className="teach-example" aria-hidden="true">
      <span className="teach-example-tag">Пример - так будет выглядеть</span>
      <div className="teach-example-body">
        {rows.map((r) => (
          <div className="teach-row" key={r.name}>
            <span>
              <strong>{r.name}</strong>
              {r.note && <small>{r.note}</small>}
            </span>
            {r.value != null && <b>{r.value}</b>}
          </div>
        ))}
        {message && <p className="teach-message">{message}</p>}
      </div>
    </div>
  );
}

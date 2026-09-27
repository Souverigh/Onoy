import { money } from "@/lib/format";
import { niceMax } from "@/lib/periods";

type Point = { date: string; value: number };

const fullDay = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long", weekday: "short" }).format(
    new Date(`${date}T12:00:00+06:00`),
  );
const shortTick = (date: string, weekly: boolean) =>
  weekly
    ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", weekday: "short" }).format(
        new Date(`${date}T12:00:00+06:00`),
      )
    : String(Number(date.slice(8)));
/** «50 тыс» — подписи оси короче полной суммы. */
const axisLabel = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString("ru-RU")} млн`
    : value >= 1000
      ? `${(value / 1000).toLocaleString("ru-RU")} тыс`
      : String(value);

/**
 * Столбцы по дням — один ряд, поэтому без легенды: что показано, говорит
 * заголовок. Подсказка — по наведению и по нажатию (focus), таблица — отдельно.
 * HTML, а не SVG: на телефоне подписи не ужимаются вместе с графиком.
 */
export function DayColumns({ title, points, through }: { title: string; points: Point[]; through: string }) {
  const weekly = points.length <= 7;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [max, max / 2, 0];
  return (
    <figure className="day-columns" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="day-columns-plot">
        <div className="day-columns-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
              {axisLabel(t)}
            </span>
          ))}
        </div>
        <div className="day-columns-area">
          {ticks.map((t) => (
            <i key={t} className="day-columns-grid" style={{ bottom: `${(t / max) * 100}%` }} />
          ))}
          <ol className="day-columns-bars">
            {points.map((p) => {
              const future = p.date > through;
              return (
                <li key={p.date} className={future ? "future" : undefined}>
                  <button type="button" className="day-columns-hit" aria-label={`${fullDay(p.date)}: ${future ? "ещё не наступил" : money(p.value)}`}>
                    <span className="day-columns-bar" style={{ height: `${(p.value / max) * 100}%` }} />
                    <span className="day-columns-tip" role="tooltip">
                      {fullDay(p.date)}
                      <strong>{future ? "ещё не наступил" : money(p.value)}</strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <span />
        <ol className="day-columns-ticks" aria-hidden="true">
          {points.map((p, i) => (
            <li key={p.date}>{weekly || i === 0 || (i + 1) % 5 === 0 ? shortTick(p.date, weekly) : ""}</li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

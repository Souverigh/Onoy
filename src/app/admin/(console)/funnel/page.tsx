import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import {
  FUNNEL_STEPS,
  FUNNEL_TIMES,
  PROBLEMS,
  durationText,
  funnel,
  hasProblem,
  isProblemKey,
  medianTime,
  reached,
  stuckAt,
  stuckText,
  type FunnelRow,
  type ProblemKey,
} from "@/lib/admin-funnel";
import { whenText } from "@/lib/admin-people";
import { bishkekDate } from "@/lib/day-summary";
import { PRESETS, isBusinessType } from "@/lib/business";
import { waPhone } from "@/lib/share";

const PERIODS = { "7": "7 дней", "30": "30 дней", "90": "90 дней", all: "Всё время" } as const;
type Period = keyof typeof PERIODS;
const DAY = 86_400_000;
const SHOW = 30;
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");
const daysAgo = (iso: string, now: Date) => {
  const d = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  return d < 1 ? "сегодня" : d === 1 ? "вчера" : `${d} дн. назад`;
};

/** Воронка: кто зарегистрировался за период и до какого шага дошёл; где уходят; кому написать. */
export default async function AdminFunnel({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; type?: string; step?: string; problem?: string }>;
}) {
  const { db } = await requirePlatformAdmin();
  const params = await searchParams;
  const { data, error } = await db.rpc("admin_funnel");
  if (error) throw new Error("Не удалось загрузить воронку");
  const now = new Date();
  const today = bishkekDate();
  const period: Period = params.period && params.period in PERIODS ? (params.period as Period) : "30";
  const type = isBusinessType(params.type) ? params.type : null;
  const all = ((data ?? []) as FunnelRow[]).filter((r) => !type || (r.business_type ?? "shop") === type);
  const days = period === "all" ? null : Number(period);
  const since = days ? now.getTime() - days * DAY : null;
  const cohort = since ? all.filter((r) => new Date(r.created_at).getTime() >= since) : all;
  const before = since ? all.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= since - days! * DAY && t < since; }).length : null;

  const { counts, drops, worst } = funnel(cohort);
  const step = Number(params.step);
  const problem: ProblemKey | null = isProblemKey(params.problem) ? params.problem : null;
  const chosenStep = problem ? null : step >= 1 && step < FUNNEL_STEPS.length ? step : worst;
  const problemRows = Object.fromEntries(
    (Object.keys(PROBLEMS) as ProblemKey[]).map((k) => [k, all.filter((r) => hasProblem(r, k, now, today))]),
  ) as Record<ProblemKey, FunnelRow[]>;
  const listed = problem ? problemRows[problem] : chosenStep !== null ? stuckAt(cohort, chosenStep) : [];
  const listTitle = problem
    ? PROBLEMS[problem]
    : chosenStep !== null
      ? `Застряли перед шагом «${FUNNEL_STEPS[chosenStep]}»`
      : "Никто не застрял";

  const href = (change: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged = { period: period === "30" ? null : period, type, step: null, problem: null, ...change };
    for (const [k, v] of Object.entries(merged)) if (v !== null) next.set(k, String(v));
    const s = next.toString();
    return s ? `/admin/funnel?${s}` : "/admin/funnel";
  };

  return (
    <>
      <div className="adm-h1">
        <h1>Воронка</h1>
        <span className="muted">Кто зарегистрировался за период и до какого шага дошёл. Где больше всего уходят - туда и смотреть.</span>
      </div>
      <form className="adm-funnel-filters" action="/admin/funnel">
        <nav className="adm-pills" aria-label="Период">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <Link key={p} className={p === period ? "on" : undefined} href={href({ period: p === "30" ? null : p })}>
              {PERIODS[p]}
            </Link>
          ))}
        </nav>
        {period !== "30" && <input type="hidden" name="period" value={period} />}
        <select name="type" defaultValue={type ?? ""} aria-label="Вид бизнеса">
          <option value="">Любой вид бизнеса</option>
          {Object.entries(PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="button" type="submit">
          Показать
        </button>
      </form>

      <div className="adm-tiles">
        <div className="adm-tile">
          <b>{counts[0]}</b>
          <span>Зарегистрировались</span>
          <small>
            {days ? `за ${days} дней` : "за всё время"}
            {before !== null ? ` · ${counts[0] - before >= 0 ? "+" : "−"}${Math.abs(counts[0] - before)} к прошлым ${days}` : ""}
          </small>
        </div>
        <div className="adm-tile">
          <b>{counts[2]}</b>
          <span>Создали магазин</span>
          <small>{pct(counts[2], counts[0])} от регистраций</small>
        </div>
        <div className="adm-tile">
          <b>{counts[5]}</b>
          <span>Стали активными</span>
          <small>3+ записи в неделю · {pct(counts[5], counts[0])}</small>
        </div>
        <div className="adm-tile">
          <b>{counts[6]}</b>
          <span>Оплатили</span>
          <small>{pct(counts[6], counts[0])} от регистраций</small>
        </div>
      </div>

      <div className="adm-cols adm-funnel-cols">
        <div>
          <section className="adm-card">
            <h2>Шаги</h2>
            {counts[0] ? (
              <ol className="adm-funnel">
                {FUNNEL_STEPS.map((label, i) => {
                  const tip = `${label}: ${counts[i]} из ${counts[0]} (${pct(counts[i], counts[0])})${i ? `, ушли на этом шаге: ${drops[i]}` : ""}`;
                  const body = (
                    <>
                      <span>{label}</span>
                      <span className="adm-bar">
                        <i style={{ width: `${(counts[i] / counts[0]) * 100}%` }} />
                      </span>
                      <span className="adm-funnel-n">{counts[i]}</span>
                      <span className="adm-funnel-drop">{i ? `−${drops[i]} · ${pct(counts[i], counts[i - 1])}` : "100%"}</span>
                    </>
                  );
                  const cls = [i === worst ? "worst" : "", i === chosenStep ? "on" : ""].filter(Boolean).join(" ") || undefined;
                  return (
                    <li key={label} className={cls} title={tip}>
                      {i ? <Link href={href({ step: i })}>{body}</Link> : <div>{body}</div>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted">За этот период никто не регистрировался.</p>
            )}
            {worst !== null && (
              <div className="adm-worst">
                <span>
                  Больше всего уходят перед шагом «{FUNNEL_STEPS[worst]}»: {drops[worst]} чел. дошли до «{FUNNEL_STEPS[worst - 1]}» и
                  остановились.
                </span>
                <Link href={href({ step: worst })}>Показать {drops[worst]} →</Link>
              </div>
            )}
            <small className="muted adm-hint">
              Справа у шага: сколько ушло на нём и какая доля прошла дальше. Наведите на шаг - подсказка с числами; нажмите -
              список людей.
            </small>
          </section>

          <section className="adm-card">
            <h2>
              Сколько занимает шаг <small className="muted">обычно (медиана)</small>
            </h2>
            <table className="adm-times">
              <tbody>
                {FUNNEL_TIMES.map((t) => {
                  const ms = medianTime(cohort, t.from, t.to);
                  return (
                    <tr key={t.label}>
                      <td>{t.label}</td>
                      <td>{ms === null ? "-" : durationText(ms)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        <div>
          <section className="adm-card" id="list">
            <h2>
              {listTitle} ({listed.length})
            </h2>
            {listed.length ? (
              <ul className="adm-stuck">
                {listed.slice(0, SHOW).map((r) => {
                  const digits = waPhone(r.phone);
                  const text = stuckText(problem ? Math.min(reached(r), 6) : chosenStep!, r.shop_name);
                  const details = r.org_id
                    ? [
                        `${r.customers ?? 0} клиент.`,
                        `магазин ${daysAgo(r.shop_created_at!, now)}`,
                        r.last_sign_in_at ? `вход ${whenText(r.last_sign_in_at, now)}` : null,
                      ]
                    : [
                        r.confirmed_at ? "почта подтверждена" : "почта не подтверждена",
                        `зарегистрировался ${daysAgo(r.created_at, now)}`,
                      ];
                  return (
                    <li key={r.user_id}>
                      <Link className="adm-row-link" href={r.org_id ? `/admin/shop/${r.org_id}` : `/admin/account/${r.user_id}`}>
                        {r.shop_name ?? r.email}
                      </Link>
                      <small>{details.filter(Boolean).join(" · ")}</small>
                      {digits.length >= 9 ? (
                        <a className="adm-contact" href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
                          💬 WhatsApp
                        </a>
                      ) : r.email ? (
                        <a className="adm-contact" href={`mailto:${r.email}`}>
                          ✉ Письмо
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">Никого.</p>
            )}
            {listed.length > SHOW && <small className="muted adm-hint">И ещё {listed.length - SHOW} - уточните период или вид бизнеса.</small>}
          </section>

          <section className="adm-card">
            <h2>
              Проблемы <small className="muted">сейчас, по всем магазинам</small>
            </h2>
            <div className="adm-problems">
              {(Object.keys(PROBLEMS) as ProblemKey[]).map((k) => (
                <Link key={k} className={`adm-problem${problem === k ? " on" : ""}`} href={href({ problem: k })}>
                  <b>{problemRows[k].length}</b>
                  {PROBLEMS[k]}
                  <span>Показать →</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

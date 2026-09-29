import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { dayNet, type AfterCloseItem, type DayMoney, type DaySummary } from "../day-summary";
import { expenseCategoryLabel } from "../expenses";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 11, padding: 36, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottom: "1 solid #e4e8e4" },
  strong: { fontWeight: "bold" },
  warn: { color: "#a4762f" },
});

const SIGN: Record<string, string> = { KGS: "сом", USD: "$", RUB: "₽" };
const sum = (n: number, currency = "KGS") =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} ${SIGN[currency] ?? currency}`;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={strong ? styles.strong : undefined}>{label}</Text>
      <Text style={strong ? styles.strong : undefined}>{value}</Text>
    </View>
  );
}

export type DayPdfData = {
  shopName: string;
  dateLabel: string;
  summary: DaySummary;
  closedAt: string | null;
  after: { added: AfterCloseItem[]; reversed: AfterCloseItem[] } | null;
};

/** Цифры дня в одной валюте. */
function MoneyBlock({ m, cur, title }: { m: DayMoney; cur: string; title?: string }) {
  return (
    <>
      {title && <Text style={[styles.title, styles.warn]}>{title}</Text>}
          <Text style={styles.title}>Продажи</Text>
          <Row label={`Продано за день (${m.sold.count} накл.)`} value={sum(m.sold.total, cur)} strong />
          <Row label="В долг" value={sum(m.sold.credit, cur)} />
          <Row label="За наличные" value={sum(m.sold.cash, cur)} />

          <Text style={styles.title}>Собрано денег</Text>
          <Row label="Всего" value={sum(m.collected.total, cur)} strong />
          <Row label="Наличными" value={sum(m.collected.cash, cur)} />
          <Row label="Переводом" value={sum(m.collected.transfer, cur)} />

          <Text style={styles.title}>Долги клиентов</Text>
          <Row label="Было утром" value={sum(m.receivable.morning, cur)} />
          <Row label="Стало вечером" value={sum(m.receivable.evening, cur)} strong />

          <Text style={styles.title}>Поставщики</Text>
          <Row label="Приход за день" value={sum(m.suppliers.purchased, cur)} />
          <Row label="Оплачено поставщикам" value={sum(m.suppliers.paid, cur)} />
          <Row label="Долг на конец дня" value={sum(m.suppliers.evening, cur)} strong />

          {m.creditByCustomer.length > 0 && (
            <>
              <Text style={styles.title}>Кому продал в долг</Text>
              {m.creditByCustomer.map((c) => (
                <Row key={c.id} label={c.name} value={sum(c.amount, cur)} />
              ))}
            </>
          )}
          {m.paidByCustomer.length > 0 && (
            <>
              <Text style={styles.title}>Кто оплатил</Text>
              {m.paidByCustomer.map((c) => (
                <Row key={c.id} label={c.name} value={sum(c.amount, cur)} />
              ))}
            </>
          )}
    </>
  );
}

/** Расходы и «Осталось за день» — в валюте магазина. */
function ExpensesBlock({ s }: { s: DaySummary }) {
  const cur = s.currency ?? "KGS";
  const net = dayNet(s);
  return (
    <>
      <Text style={styles.title}>Расходы</Text>
      <Row label="Расходы за день" value={sum(net.expenses, cur)} strong />
      {s.expenses?.byCategory.map((c) => (
        <Row key={c.category} label={expenseCategoryLabel(c.category)} value={sum(c.amount, cur)} />
      ))}

      <Text style={styles.title}>Осталось за день</Text>
      <Row label="Пришло (наличные продажи + собрано)" value={sum(net.income, cur)} />
      <Row label="Оплачено поставщикам" value={`− ${sum(net.paid, cur)}`} />
      <Row label="Расходы" value={`− ${sum(net.expenses, cur)}`} />
      <Row label="Осталось" value={sum(net.left, cur)} strong />
    </>
  );
}

function DayDocument({ data }: { data: DayPdfData }) {
  const s = data.summary;
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone: "Asia/Bishkek" }).format(new Date(iso));
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.shopName}>{data.shopName}</Text>
        <Text style={styles.muted}>
          Итог дня — {data.dateLabel}
          {data.closedAt ? ` · день закрыт в ${time(data.closedAt)}` : " · день не закрыт, цифры на сейчас"}
        </Text>

        <MoneyBlock m={s} cur={s.currency ?? "KGS"} />
        <ExpensesBlock s={s} />
        {s.foreign?.map((part) => (
          <MoneyBlock
            key={part.currency}
            m={part}
            cur={part.currency}
            title={`В валюте ${SIGN[part.currency] ?? part.currency} — отдельно от основных цифр`}
          />
        ))}
        {data.after && (data.after.added.length > 0 || data.after.reversed.length > 0) && (
          <>
            <Text style={[styles.title, styles.warn]}>После закрытия</Text>
            {data.after.added.map((i, n) => (
              <Row key={`a${n}`} label={`+ ${i.label}${i.party ? ` · ${i.party}` : ""} · ${time(i.at)}`} value={sum(i.amount, i.currency)} />
            ))}
            {data.after.reversed.map((i, n) => (
              <Row key={`r${n}`} label={`Отменена: ${i.label}${i.party ? ` · ${i.party}` : ""} · ${time(i.at)}`} value={sum(i.amount, i.currency)} />
            ))}
          </>
        )}
        {s.pendingClaims > 0 && (
          <Text style={[styles.muted, { marginTop: 14 }]}>
            Заявок на оплату ждали подтверждения: {s.pendingClaims}
          </Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderDayPdf(origin: string, data: DayPdfData): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<DayDocument data={data} />);
}

import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import type { AfterCloseItem, DaySummary } from "../day-summary";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 11, padding: 36, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottom: "1 solid #e4e8e4" },
  strong: { fontWeight: "bold" },
  warn: { color: "#a4762f" },
});

const sum = (n: number) =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} сом`;

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

        <Text style={styles.title}>Продажи</Text>
        <Row label={`Продано за день (${s.sold.count} накл.)`} value={sum(s.sold.total)} strong />
        <Row label="В долг" value={sum(s.sold.credit)} />
        <Row label="За наличные" value={sum(s.sold.cash)} />

        <Text style={styles.title}>Собрано денег</Text>
        <Row label="Всего" value={sum(s.collected.total)} strong />
        <Row label="Наличными" value={sum(s.collected.cash)} />
        <Row label="Переводом" value={sum(s.collected.transfer)} />

        <Text style={styles.title}>Долги клиентов</Text>
        <Row label="Было утром" value={sum(s.receivable.morning)} />
        <Row label="Стало вечером" value={sum(s.receivable.evening)} strong />

        <Text style={styles.title}>Поставщики</Text>
        <Row label="Приход за день" value={sum(s.suppliers.purchased)} />
        <Row label="Оплачено поставщикам" value={sum(s.suppliers.paid)} />
        <Row label="Долг на конец дня" value={sum(s.suppliers.evening)} strong />

        {s.creditByCustomer.length > 0 && (
          <>
            <Text style={styles.title}>Кому продал в долг</Text>
            {s.creditByCustomer.map((c) => (
              <Row key={c.id} label={c.name} value={sum(c.amount)} />
            ))}
          </>
        )}
        {s.paidByCustomer.length > 0 && (
          <>
            <Text style={styles.title}>Кто оплатил</Text>
            {s.paidByCustomer.map((c) => (
              <Row key={c.id} label={c.name} value={sum(c.amount)} />
            ))}
          </>
        )}
        {data.after && (data.after.added.length > 0 || data.after.reversed.length > 0) && (
          <>
            <Text style={[styles.title, styles.warn]}>После закрытия</Text>
            {data.after.added.map((i, n) => (
              <Row key={`a${n}`} label={`+ ${i.label} · ${i.party} · ${time(i.at)}`} value={sum(i.amount)} />
            ))}
            {data.after.reversed.map((i, n) => (
              <Row key={`r${n}`} label={`Отменена: ${i.label} · ${i.party} · ${time(i.at)}`} value={sum(i.amount)} />
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

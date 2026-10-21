import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { statementDay, statementEntryLabel, statementRows, type StatementEntry } from "../statement-data";
import { money } from "../format";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 10, padding: 36, color: "#1d2a2a" },
  eyebrow: { color: "#73807e", fontSize: 9, letterSpacing: 1, marginBottom: 2 },
  party: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  totals: { flexDirection: "row", marginTop: 16, marginBottom: 14, borderTop: "1 solid #e4e8e4", borderBottom: "1 solid #e4e8e4" },
  total: { flex: 1, paddingVertical: 8, paddingRight: 8 },
  totalLabel: { color: "#73807e", fontSize: 9, marginBottom: 3 },
  totalValue: { fontSize: 12, fontWeight: "bold" },
  tr: { flexDirection: "row", borderBottom: "1 solid #e4e8e4", paddingVertical: 5 },
  edge: { backgroundColor: "#f6f7f4", fontWeight: "bold" },
  th: { fontWeight: "bold", color: "#4d5b58" },
  date: { width: "15%", paddingHorizontal: 3 },
  what: { width: "28%", paddingHorizontal: 3 },
  num: { width: "19%", paddingHorizontal: 3, textAlign: "right" },
  plus: { color: "#a0472c" },
  minus: { color: "#245d4c" },
  reversed: { color: "#a4762f", textDecoration: "line-through" },
  sign: { flexDirection: "row", marginTop: 36, gap: 40 },
  signBox: { flex: 1, borderTop: "1 solid #9aa5a2", paddingTop: 4, color: "#73807e", fontSize: 9 },
});

export type StatementPdfData = {
  shopName: string;
  currency: string;
  partyName: string;
  from: string;
  to: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" }).format(
    new Date(iso),
  );

/** Акт сверки: итоги в одну строку, таблица «+ / − / остаток», места для подписей. */
function StatementDocument({ data }: { data: StatementPdfData }) {
  const cur = data.currency;
  const sum = (n: number) => money(n.toFixed(2), cur);
  const { rows, plus, minus } = statementRows(data);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>АКТ СВЕРКИ</Text>
        <Text style={styles.party}>{data.partyName}</Text>
        <Text style={styles.muted}>
          {data.shopName} · {statementDay(data.from)} – {statementDay(data.to)}
        </Text>

        <View style={styles.totals}>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Долг на {statementDay(data.from)}</Text>
            <Text style={styles.totalValue}>{sum(data.opening)}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Долг вырос</Text>
            <Text style={[styles.totalValue, styles.plus]}>+ {sum(plus)}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Долг уменьшился</Text>
            <Text style={[styles.totalValue, styles.minus]}>− {sum(minus)}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Долг на {statementDay(data.to)}</Text>
            <Text style={styles.totalValue}>{sum(data.closing)}</Text>
          </View>
        </View>

        <View style={styles.tr} fixed>
          <Text style={[styles.date, styles.th]}>Дата</Text>
          <Text style={[styles.what, styles.th]}>Операция</Text>
          <Text style={[styles.num, styles.th]}>Долг вырос</Text>
          <Text style={[styles.num, styles.th]}>Уменьшился</Text>
          <Text style={[styles.num, styles.th]}>Остаток</Text>
        </View>
        <View style={[styles.tr, styles.edge]} wrap={false}>
          <Text style={styles.date}>{statementDay(data.from)}</Text>
          <Text style={styles.what}>Долг на начало</Text>
          <Text style={styles.num} />
          <Text style={styles.num} />
          <Text style={styles.num}>{sum(data.opening)}</Text>
        </View>
        {rows.map((row, i) => {
          const off = row.reversed ? styles.reversed : undefined;
          return (
            <View style={styles.tr} key={i} wrap={false}>
              <Text style={[styles.date, off ?? {}]}>{day(row.occurred_at)}</Text>
              <Text style={[styles.what, off ?? {}]}>
                {statementEntryLabel(row)}
                {row.reversed ? " (отменена)" : ""}
              </Text>
              <Text style={[styles.num, off ?? styles.plus]}>{row.plus ? sum(row.plus) : ""}</Text>
              <Text style={[styles.num, off ?? styles.minus]}>{row.minus ? sum(row.minus) : ""}</Text>
              <Text style={styles.num}>{row.reversed ? "" : sum(row.balance)}</Text>
            </View>
          );
        })}
        <View style={[styles.tr, styles.edge]} wrap={false}>
          <Text style={styles.date}>{statementDay(data.to)}</Text>
          <Text style={styles.what}>Долг на конец</Text>
          <Text style={[styles.num, styles.plus]}>{sum(plus)}</Text>
          <Text style={[styles.num, styles.minus]}>{sum(minus)}</Text>
          <Text style={styles.num}>{sum(data.closing)}</Text>
        </View>

        <View style={styles.sign} wrap={false}>
          <Text style={styles.signBox}>{data.shopName}</Text>
          <Text style={styles.signBox}>{data.partyName}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(origin: string, data: StatementPdfData): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<StatementDocument data={data} />);
}

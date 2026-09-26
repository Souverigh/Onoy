import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import type { StatementEntry } from "../statement-data";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 11, padding: 36, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 18, marginBottom: 10 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTop: "1 solid #e4e8e4" },
  table: { marginTop: 4 },
  tr: { flexDirection: "row", borderBottom: "1 solid #e4e8e4", paddingVertical: 6 },
  thDate: { width: 90, fontWeight: "bold" },
  thKind: { flex: 1, fontWeight: "bold" },
  thSum: { width: 90, fontWeight: "bold", textAlign: "right" },
  date: { width: 90, color: "#73807e" },
  kindCell: { flex: 1 },
  sum: { width: 90, textAlign: "right" },
  reversed: { color: "#a4762f" },
});

const kindLabel: Record<StatementEntry["kind"], string> = {
  sale: "Продажа",
  purchase: "Приход",
  payment: "Оплата",
};

export type StatementPdfData = {
  shopName: string;
  partyName: string;
  from: string;
  to: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
};

function StatementDocument({ data }: { data: StatementPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.shopName}>{data.shopName}</Text>
        <Text style={styles.muted}>Акт сверки — {data.partyName}</Text>
        <Text style={styles.title}>
          Период: {data.from} — {data.to}
        </Text>
        <View style={styles.balanceRow}>
          <Text>Сальдо на начало периода</Text>
          <Text>{data.opening.toFixed(2)} сом</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={styles.thDate}>Дата</Text>
            <Text style={styles.thKind}>Операция</Text>
            <Text style={styles.thSum}>Сумма</Text>
          </View>
          {data.entries.map((entry, i) => (
            <View style={styles.tr} key={i}>
              <Text style={entry.reversed ? [styles.date, styles.reversed] : styles.date}>
                {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Bishkek" }).format(
                  new Date(entry.occurred_at),
                )}
              </Text>
              <Text style={entry.reversed ? [styles.kindCell, styles.reversed] : styles.kindCell}>
                {kindLabel[entry.kind]}
                {entry.reversed ? " (сторно)" : ""}
              </Text>
              <Text style={entry.reversed ? [styles.sum, styles.reversed] : styles.sum}>
                {entry.amount.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.balanceRow}>
          <Text>Сальдо на конец периода</Text>
          <Text>{data.closing.toFixed(2)} сом</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(origin: string, data: StatementPdfData): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<StatementDocument data={data} />);
}

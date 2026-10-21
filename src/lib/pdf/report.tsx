import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { money, quantity } from "../format";
import type { Cell } from "../xlsx";
import type { ReportDoc } from "../report-export";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 10, padding: 36, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  title: { fontSize: 13, fontWeight: "bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottom: "1 solid #e4e8e4" },
  strong: { fontWeight: "bold" },
  sub: { color: "#73807e", paddingLeft: 10 },
  tr: { flexDirection: "row", borderBottom: "1 solid #e4e8e4", paddingVertical: 4 },
  th: { fontWeight: "bold", color: "#4d5b58" },
  // Отступ между колонками: «54» и «т» не слипаются.
  cell: { paddingHorizontal: 4 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, color: "#9aa5a2", fontSize: 8, textAlign: "center" },
});

const dateText = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/** Ячейка таблицы для PDF: деньги — с валютой, даты — «21.10.2026». */
function cellText(value: Cell, kind: string | undefined, currency: string) {
  if (value == null || value === "") return "-";
  if (value instanceof Date) return dateText(value);
  if (typeof value === "number") return kind === "money" ? money(value.toFixed(2), currency) : quantity(String(value));
  return value;
}

function ReportDocument({ doc }: { doc: ReportDoc }) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.shopName}>{doc.shopName}</Text>
        <Text style={styles.muted}>
          {doc.title} · {doc.periodText}
        </Text>

        <Text style={styles.title}>Итоги</Text>
        {doc.summary.map((line, i) => {
          const sub = line.label.startsWith("  ");
          return (
            <View style={styles.row} key={i} wrap={false}>
              <Text style={sub ? styles.sub : styles.strong}>{line.label.trim()}</Text>
              <Text style={sub ? styles.sub : styles.strong}>
                {line.money ? money(line.value.toFixed(2), doc.currency) : quantity(String(line.value))}
              </Text>
            </View>
          );
        })}

        {doc.tables
          .filter((t) => t.rows.length > 0)
          .map((t) => {
            // Ширина колонок — по ширине из Excel, текст — шире остальных.
            const total = t.columns.reduce((s, c) => s + (c.width ?? 14), 0);
            const width = (w = 14) => `${(w / total) * 100}%`;
            return (
              <View key={t.title}>
                <Text style={styles.title} minPresenceAhead={40}>
                  {t.title}
                </Text>
                <View style={styles.tr}>
                  {t.columns.map((c, i) => (
                    <Text
                      key={i}
                      style={[styles.th, styles.cell, { width: width(c.width), textAlign: c.kind && c.kind !== "text" && c.kind !== "date" ? "right" : "left" }]}
                    >
                      {c.header}
                    </Text>
                  ))}
                </View>
                {t.rows.map((row, r) => (
                  <View style={styles.tr} key={r} wrap={false}>
                    {t.columns.map((c, i) => (
                      <Text
                        key={i}
                        style={[styles.cell, { width: width(c.width), textAlign: c.kind && c.kind !== "text" && c.kind !== "date" ? "right" : "left" }]}
                      >
                        {cellText(row[i], c.kind, doc.currency)}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            );
          })}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Depter · ${doc.shopName} · стр. ${pageNumber} из ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export async function renderReportPdf(origin: string, doc: ReportDoc): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<ReportDocument doc={doc} />);
}

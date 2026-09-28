import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { money } from "../format";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 11, padding: 36, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  muted: { color: "#73807e", fontSize: 10 },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 18, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  table: { marginTop: 10, borderTop: "1 solid #e4e8e4" },
  tr: { flexDirection: "row", borderBottom: "1 solid #e4e8e4", paddingVertical: 6 },
  thN: { width: 24, fontWeight: "bold" },
  thName: { flex: 1, fontWeight: "bold" },
  thQty: { width: 60, fontWeight: "bold", textAlign: "right" },
  thPrice: { width: 70, fontWeight: "bold", textAlign: "right" },
  thSum: { width: 80, fontWeight: "bold", textAlign: "right" },
  n: { width: 24, color: "#73807e" },
  name: { flex: 1 },
  qty: { width: 60, textAlign: "right" },
  price: { width: 70, textAlign: "right" },
  sum: { width: 80, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, fontSize: 14, fontWeight: "bold" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 9, color: "#9aa39a" },
});

export type InvoiceLine = { n: number; name_raw: string; qty: string; unit: string; price: string; sum: string };
export type InvoiceData = {
  shopName: string;
  shopPhone: string;
  kindLabel: string;
  partyName: string;
  date: string;
  total: number;
  /** Валюта накладной (итога и строк). */
  currency: string;
  /** Накладная в другой валюте, чем долг: «В долг: 8 823,9 сом по 87,8». */
  debtNote?: string | null;
  lines: InvoiceLine[];
  digitized: boolean;
};

function InvoiceDocument({ data }: { data: InvoiceData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.shopName}>{data.shopName}</Text>
        {data.shopPhone && <Text style={styles.muted}>{data.shopPhone}</Text>}
        <Text style={styles.title}>{data.kindLabel}</Text>
        <View style={styles.row}>
          <Text>Контрагент: {data.partyName}</Text>
          <Text>{data.date}</Text>
        </View>
        {data.lines.length > 0 && (
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={styles.thN}>№</Text>
              <Text style={styles.thName}>Наименование</Text>
              <Text style={styles.thQty}>Кол-во</Text>
              <Text style={styles.thPrice}>Цена</Text>
              <Text style={styles.thSum}>Сумма</Text>
            </View>
            {data.lines.map((line) => (
              <View style={styles.tr} key={line.n}>
                <Text style={styles.n}>{line.n}</Text>
                <Text style={styles.name}>{line.name_raw}</Text>
                <Text style={styles.qty}>
                  {line.qty} {line.unit}
                </Text>
                <Text style={styles.price}>{line.price}</Text>
                <Text style={styles.sum}>{line.sum}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.total}>
          <Text>Итого</Text>
          <Text>{money(data.total.toFixed(2), data.currency)}</Text>
        </View>
        {data.debtNote && <Text style={styles.footer}>{data.debtNote}</Text>}
        <Text style={styles.footer}>
          {data.digitized
            ? "Позиции сверены автоматическим распознаванием (ADRE)."
            : "Итог указан продавцом вручную; позиции — по фото оригинала."}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(origin: string, data: InvoiceData): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<InvoiceDocument data={data} />);
}

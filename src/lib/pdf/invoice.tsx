import "server-only";
import { Document, Page, Text, View, Svg, Path, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { ensureFontsRegistered } from "./fonts";
import { money, quantity } from "../format";

// Вид — по образцу накладной магазина (nakladnaya_obrazec.pdf): синяя шапка
// таблицы, итог с количеством, долг после накладной, подписи и QR на ссылку.
const BLUE = "#4f7cac";
const DARK_BLUE = "#2f5b8a";
const GRID = "#c9d6e3";
const MUTED = "#73807e";

const styles = StyleSheet.create({
  page: { fontFamily: "PT Sans", fontSize: 10, paddingTop: 26, paddingBottom: 26, paddingHorizontal: 40, color: "#1d2a2a" },
  shopName: { fontSize: 18, fontWeight: "bold", color: DARK_BLUE, textAlign: "center" },
  title: { fontSize: 12.5, fontWeight: "bold", color: BLUE, textAlign: "center", marginTop: 6 },
  rule: { borderBottom: `1.5 solid ${BLUE}`, marginTop: 6, marginBottom: 8 },
  head: { flexDirection: "row", backgroundColor: BLUE, color: "#ffffff", fontWeight: "bold", fontSize: 9 },
  headCell: { paddingVertical: 4, paddingHorizontal: 6, textAlign: "center" },
  tr: { flexDirection: "row", borderBottom: `0.75 solid ${GRID}` },
  cell: { paddingVertical: 2, paddingHorizontal: 6 },
  n: { width: 34, textAlign: "center", color: MUTED },
  name: { flex: 1, borderLeft: `0.75 solid ${GRID}` },
  qty: { width: 70, textAlign: "right", borderLeft: `0.75 solid ${GRID}` },
  price: { width: 70, textAlign: "right", borderLeft: `0.75 solid ${GRID}` },
  sum: { width: 90, textAlign: "right", fontWeight: "bold", borderLeft: `0.75 solid ${GRID}` },
  totalRow: { flexDirection: "row", alignItems: "center", borderTop: `1.5 solid ${BLUE}`, borderBottom: `0.75 solid ${GRID}`, paddingVertical: 6 },
  totalLabel: { flex: 1, textAlign: "right", fontWeight: "bold", fontSize: 11.5, paddingRight: 6 },
  totalQty: { width: 70, textAlign: "right", fontWeight: "bold", fontSize: 11.5, paddingHorizontal: 6 },
  totalSum: { width: 160, textAlign: "right", fontWeight: "bold", fontSize: 14, paddingHorizontal: 6 },
  note: { textAlign: "right", color: MUTED, marginTop: 6 },
  parties: { flexDirection: "row", marginTop: 16 },
  party: { flex: 1, paddingRight: 24 },
  partyLine: { flexDirection: "row", alignItems: "flex-end" },
  label: { fontWeight: "bold" },
  sign: { flex: 1, marginLeft: 10, minWidth: 70, alignItems: "center" },
  signLine: { borderBottom: `0.75 solid ${BLUE}`, alignSelf: "stretch", height: 10 },
  signCaption: { fontSize: 7, color: MUTED, marginTop: 2 },
  phone: { marginTop: 6 },
  qrRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  qrBlock: { flexDirection: "row", alignItems: "center" },
  qrText: { marginLeft: 14, color: MUTED, fontSize: 9, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 10, left: 40, right: 40, fontSize: 8, color: "#9aa39a" },
});

/** Реклама Depter внизу накладной — если нет ссылки-счётчика магазина (src/lib/promo.ts). */
const PROMO_URL = "https://depter.kg";

export const ITEMS_FOOTER = "Накладная оформлена в Depter по складу магазина.";

/** Числа строк — как пришли из базы (numeric текстом); форматирует шаблон. */
export type InvoiceLine = { n: number; name_raw: string; qty: string; unit: string; price: string; sum: string };
export type InvoiceParty = { name: string; phone?: string | null };
export type InvoiceData = {
  shopName: string;
  /** «Товарная накладная», «Приходная накладная»… */
  kindLabel: string;
  /** Порядковый номер накладной; нет — заголовок без номера. */
  number?: number | null;
  /** Дата операции (ISO). */
  occurredAt: string;
  total: number;
  /** Валюта накладной (итога и строк). */
  currency: string;
  /** Накладная в другой валюте, чем долг: «В долг: 8 823,9 сом по 87,8». */
  debtNote?: string | null;
  /** «Долг покупателя после этой накладной: 50 120 сом». */
  balanceNote?: string | null;
  buyer: InvoiceParty;
  seller: InvoiceParty;
  lines: InvoiceLine[];
  digitized: boolean;
  /** Ссылка клиента (накладные, долг, оплата) — печатается QR-кодом. */
  clientUrl?: string | null;
  /** Рекламный QR магазина (/r/<код>) — переходы видны в админке. */
  promoUrl?: string | null;
  /** Своя подпись внизу (накладная из приложения — не по фото). */
  footer?: string;
};

const num = (value: string | number) => {
  try {
    return quantity(value);
  } catch {
    return String(value ?? "");
  }
};

/** «03» октября 2026 г. — в часовом поясе магазина. */
function longDate(iso: string) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bishkek",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `«${part("day")}» ${part("month")} ${part("year")} г.`;
}

/** Общее количество — только когда у всех строк одна единица. */
function totalQuantity(lines: InvoiceLine[]) {
  if (!lines.length || new Set(lines.map((l) => l.unit || "шт")).size > 1) return "";
  const sum = lines.reduce((acc, l) => acc + Number(l.qty), 0);
  return Number.isFinite(sum) ? num(sum.toFixed(3)) : "";
}

function QrCode({ text, size }: { text: string; size: number }) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  let d = "";
  for (let r = 0; r < modules.size; r++)
    for (let c = 0; c < modules.size; c++) if (modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${modules.size} ${modules.size}`}>
      <Path d={d} fill="#000000" />
    </Svg>
  );
}

function Party({ label, party }: { label: string; party: InvoiceParty }) {
  return (
    <View style={styles.party}>
      <View style={styles.partyLine}>
        <Text>
          <Text style={styles.label}>{label}: </Text>
          {party.name}
        </Text>
        <View style={styles.sign}>
          <View style={styles.signLine} />
          <Text style={styles.signCaption}>подпись</Text>
        </View>
      </View>
      <Text style={styles.phone}>
        <Text style={styles.label}>ТЕЛ: </Text>
        {party.phone || "—"}
      </Text>
    </View>
  );
}

function InvoiceDocument({ data }: { data: InvoiceData }) {
  const title = `${data.kindLabel.toUpperCase()}${data.number ? ` № ${data.number}` : ""} от ${longDate(data.occurredAt)}`;
  const showUnit = (unit: string) => (unit && unit !== "шт" ? ` ${unit}` : "");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.shopName}>«{data.shopName.toUpperCase()}»</Text>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.rule} />

        {data.lines.length > 0 && (
          <View>
            <View style={styles.head}>
              <Text style={[styles.headCell, { width: 34 }]}>№</Text>
              <Text style={[styles.headCell, { flex: 1 }]}>НАИМЕНОВАНИЕ ТОВАРА</Text>
              <Text style={[styles.headCell, { width: 70 }]}>КОЛ-ВО</Text>
              <Text style={[styles.headCell, { width: 70 }]}>ЦЕНА</Text>
              <Text style={[styles.headCell, { width: 90 }]}>СУММА</Text>
            </View>
            {data.lines.map((line, i) => (
              <View style={styles.tr} key={i} wrap={false}>
                <Text style={[styles.cell, styles.n]}>{line.n || i + 1}.</Text>
                <Text style={[styles.cell, styles.name]}>{line.name_raw}</Text>
                <Text style={[styles.cell, styles.qty]}>
                  {num(line.qty)}
                  {showUnit(line.unit)}
                </Text>
                <Text style={[styles.cell, styles.price]}>{num(line.price)}</Text>
                <Text style={[styles.cell, styles.sum]}>{num(line.sum)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.totalLabel}>ОБЩАЯ СУММА:</Text>
          <Text style={styles.totalQty}>{totalQuantity(data.lines)}</Text>
          <Text style={styles.totalSum}>{money(data.total.toFixed(2), data.currency)}</Text>
        </View>
        {data.debtNote && <Text style={styles.note}>{data.debtNote}</Text>}
        {data.balanceNote && <Text style={styles.note}>{data.balanceNote}</Text>}

        <View style={styles.parties} wrap={false}>
          <Party label="ПОКУПАТЕЛЬ" party={data.buyer} />
          <Party label="ПРОДАВЕЦ" party={data.seller} />
        </View>

        <View style={styles.qrRow} wrap={false}>
          {data.clientUrl ? (
            <View style={styles.qrBlock}>
              <QrCode text={data.clientUrl} size={54} />
              <Text style={styles.qrText}>
                Накладные, долг и оплата —{"\n"}по QR-коду или ссылке: {data.clientUrl.replace(/^https?:\/\//, "")}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View style={styles.qrBlock}>
            <Text style={[styles.qrText, { marginLeft: 0, marginRight: 10, textAlign: "right" }]}>
              Накладная сделана в Depter —{"\n"}учёт долгов и склада: depter.kg
            </Text>
            <QrCode text={data.promoUrl ?? PROMO_URL} size={54} />
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {data.footer ??
            (data.digitized
              ? "Позиции сверены автоматическим распознаванием (ADRE)."
              : "Итог указан продавцом вручную; позиции — по фото оригинала.")}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(origin: string, data: InvoiceData): Promise<Buffer> {
  ensureFontsRegistered(origin);
  return renderToBuffer(<InvoiceDocument data={data} />);
}

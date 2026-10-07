import "server-only";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { phoneText } from "../format";
import { FOOTER, amount, invoiceTitle, qtyText, totalQuantity, totalText, type InvoiceData, type InvoiceParty } from "./invoice";

// Картинка накладной для экрана и WhatsApp (задача 8) — тот же вид, что PDF
// (invoice.tsx): синяя шапка таблицы, итог, подписи, один QR на страницу
// клиента. Satori: только flexbox, у блока с несколькими детьми — display:flex.
const BLUE = "#4f7cac";
const DARK_BLUE = "#2f5b8a";
const GRID = "#c9d6e3";
const MUTED = "#73807e";
const INK = "#1d2a2a";

const WIDTH = 1000;
const PAD = 48;

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] | null = null;
async function loadFonts(origin: string) {
  if (fonts) return fonts;
  const [regular, bold] = await Promise.all(
    ["PTSans-Regular.ttf", "PTSans-Bold.ttf"].map(async (file) => {
      const res = await fetch(`${origin}/fonts/${file}`);
      if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
      return res.arrayBuffer();
    }),
  );
  fonts = [
    { name: "PT Sans", data: regular, weight: 400, style: "normal" },
    { name: "PT Sans", data: bold, weight: 700, style: "normal" },
  ];
  return fonts;
}

async function qrDataUrl(text: string) {
  const svg = await QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Строк в названии при ширине колонки ~520 px и шрифте 18 px. */
const nameLines = (name: string) => Math.max(1, Math.ceil(name.length / 44));

function Party({ label, party }: { label: string; party: InvoiceParty }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div style={{ display: "flex", fontSize: 18 }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>{label}:</span>
          <span>{party.name || " "}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, marginLeft: 12, minWidth: 120 }}>
          <div style={{ display: "flex", alignSelf: "stretch", borderBottom: `1.5px solid ${BLUE}`, height: 18 }} />
          <span style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>подпись</span>
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 18, marginTop: 10 }}>
        <span style={{ fontWeight: 700, marginRight: 6 }}>ТЕЛ:</span>
        <span>{phoneText(party.phone) || "-"}</span>
      </div>
    </div>
  );
}

export async function renderInvoiceImage(origin: string, data: InvoiceData): Promise<ImageResponse> {
  const [fontList, qr] = await Promise.all([loadFonts(origin), data.clientUrl ? qrDataUrl(data.clientUrl) : null]);
  const rowsHeight = data.lines.reduce((h, line) => h + 10 + 26 * nameLines(line.name_raw), 0);
  const notes = [data.debtNote, data.balanceNote].filter(Boolean) as string[];
  const height =
    PAD * 2 + 48 + 44 + 34 + (data.lines.length ? 44 + rowsHeight : 0) + 64 + notes.length * 30 + 40 + 96 + (qr ? 128 : 0) - 20;
  const col = { n: 56, qty: 120, price: 130, sum: 150 };
  const cell = { padding: "6px 10px", fontSize: 18, display: "flex" } as const;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          color: INK,
          fontFamily: "PT Sans",
          padding: PAD,
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", fontSize: 34, fontWeight: 700, color: DARK_BLUE, textAlign: "center" }}>
          «{data.shopName.toUpperCase()}»
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: 24, fontWeight: 700, color: BLUE, marginTop: 10, textAlign: "center" }}>
          {invoiceTitle(data)}
        </div>
        <div style={{ display: "flex", borderBottom: `3px solid ${BLUE}`, marginTop: 12, marginBottom: 16 }} />

        {data.lines.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", background: BLUE, color: "#ffffff", fontWeight: 700, fontSize: 17 }}>
              <div style={{ ...cell, fontSize: 17, width: col.n, justifyContent: "center", padding: "10px 6px" }}>№</div>
              <div style={{ ...cell, fontSize: 17, flex: 1, justifyContent: "center", padding: "10px 6px" }}>НАИМЕНОВАНИЕ ТОВАРА</div>
              <div style={{ ...cell, fontSize: 17, width: col.qty, justifyContent: "center", padding: "10px 6px" }}>КОЛ-ВО</div>
              <div style={{ ...cell, fontSize: 17, width: col.price, justifyContent: "center", padding: "10px 6px" }}>ЦЕНА</div>
              <div style={{ ...cell, fontSize: 17, width: col.sum, justifyContent: "center", padding: "10px 6px" }}>СУММА</div>
            </div>
            {data.lines.map((line, i) => (
              <div key={i} style={{ display: "flex", borderBottom: `1px solid ${GRID}` }}>
                <div style={{ ...cell, width: col.n, justifyContent: "center", color: MUTED }}>{`${line.n || i + 1}.`}</div>
                <div style={{ ...cell, flex: 1, borderLeft: `1px solid ${GRID}` }}>{line.name_raw}</div>
                <div style={{ ...cell, width: col.qty, justifyContent: "flex-end", borderLeft: `1px solid ${GRID}` }}>{qtyText(line)}</div>
                <div style={{ ...cell, width: col.price, justifyContent: "flex-end", borderLeft: `1px solid ${GRID}` }}>
                  {amount(line.price, data.currency)}
                </div>
                <div style={{ ...cell, width: col.sum, justifyContent: "flex-end", fontWeight: 700, borderLeft: `1px solid ${GRID}` }}>
                  {amount(line.sum, data.currency)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderTop: `3px solid ${BLUE}`,
            borderBottom: `1px solid ${GRID}`,
            padding: "12px 0",
          }}
        >
          <div style={{ display: "flex", flex: 1, justifyContent: "flex-end", fontSize: 21, fontWeight: 700, paddingRight: 10 }}>
            ОБЩАЯ СУММА:
          </div>
          <div style={{ display: "flex", width: col.qty, justifyContent: "flex-end", fontSize: 21, fontWeight: 700, padding: "0 10px" }}>
            {totalQuantity(data.lines) || " "}
          </div>
          <div style={{ display: "flex", width: col.price + col.sum, justifyContent: "flex-end", fontSize: 27, fontWeight: 700, padding: "0 10px" }}>
            {totalText(data)}
          </div>
        </div>
        {notes.map((note) => (
          <div key={note} style={{ display: "flex", justifyContent: "flex-end", color: MUTED, fontSize: 17, marginTop: 8 }}>
            {note}
          </div>
        ))}

        <div style={{ display: "flex", marginTop: 32 }}>
          <Party label="ПОКУПАТЕЛЬ" party={data.buyer} />
          <Party label="ПРОДАВЕЦ" party={data.seller} />
        </div>

        {qr && (
          <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} width={104} height={104} alt="" />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 18, color: MUTED, fontSize: 17 }}>
              <span>Накладные, долг и оплата -</span>
              <span>по QR-коду</span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", color: "#9aa39a", fontSize: 13 }}>{FOOTER}</div>
      </div>
    ),
    {
      width: WIDTH,
      height,
      fonts: fontList,
      headers: { "cache-control": "private, max-age=60" },
    },
  );
}

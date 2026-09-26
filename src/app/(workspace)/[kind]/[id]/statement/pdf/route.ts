import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { getStatementData } from "@/lib/statement-data";
import { renderStatementPdf } from "@/lib/pdf/statement";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  if (kind !== "customers" && kind !== "suppliers")
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId } = await getContext();
  const { searchParams } = new URL(request.url);
  const statement = await getStatementData(
    db,
    organizationId,
    kind,
    id,
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined,
  );
  if (!statement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const origin = new URL(request.url).origin;
  const pdf = await renderStatementPdf(origin, statement);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="akt-sverki-${id.slice(0, 8)}.pdf"`,
    },
  });
}

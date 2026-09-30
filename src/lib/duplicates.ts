/**
 * Ссылка «первая запись» у дубликата оплаты: документ с фото чека, если он
 * есть (там фото, данные чека и сама запись), иначе строка в истории
 * контрагента (якорь pay-<id>, подсвечивается через :target).
 */
export function firstPaymentHref(first: {
  id: string;
  document_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
}) {
  if (first.document_id) return `/documents/${first.document_id}`;
  const partyId = first.customer_id ?? first.supplier_id;
  if (!partyId) return null;
  return `/${first.customer_id ? "customers" : "suppliers"}/${partyId}#pay-${first.id}`;
}

/** Почему дубликат: тот же номер перевода или то же фото чека. */
export function duplicateReason(
  payment: { bank_reference: string | null },
  first: { bank_reference: string | null } | undefined,
) {
  return payment.bank_reference && first?.bank_reference === payment.bank_reference
    ? `Номер перевода ${payment.bank_reference}`
    : "Этот же чек (то же фото)";
}

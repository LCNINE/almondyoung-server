function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR') : '';
}

function normalizedPhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function canonicalConsolidationRecipient(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {
    recipientName: normalizedText(input.recipientName),
    phone: normalizedPhone(input.phone),
    postalCode: normalizedText(input.postalCode),
    roadAddress: normalizedText(input.roadAddress),
    detailAddress: normalizedText(input.detailAddress),
  };
  if (typeof input.deliveryNote === 'string' && input.deliveryNote.trim()) {
    result.deliveryNote = input.deliveryNote.trim().replace(/\s+/g, ' ');
  }
  if (Object.entries(result).some(([key, entry]) => key !== 'deliveryNote' && !entry)) return null;
  return result;
}

export interface ConsolidationCustomerLine {
  salesOrderId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

/** 판매주문 없는 라인이 있거나 주문들의 고객이 갈리면 null. customerId 가 있으면 그것만 본다. */
export function consolidationCustomerKey(lines: readonly ConsolidationCustomerLine[]): string | null {
  const orders = new Map<string, Omit<ConsolidationCustomerLine, 'salesOrderId'>>();
  for (const line of lines) {
    if (!line.salesOrderId) return null;
    orders.set(line.salesOrderId, {
      customerId: line.customerId,
      customerName: line.customerName,
      customerPhone: line.customerPhone,
    });
  }
  const rows = [...orders.values()];
  const customerIds = [...new Set(rows.flatMap((row) => (row.customerId ? [row.customerId] : [])))].sort();
  if (customerIds.length > 0) {
    return customerIds.length === 1 && rows.every((row) => row.customerId === customerIds[0])
      ? `id:${customerIds[0]}`
      : null;
  }
  const identities = [
    ...new Set(rows.map((row) => `${normalizedText(row.customerName)}:${normalizedPhone(row.customerPhone)}`)),
  ].sort();
  return identities.length === 1 && !identities[0].startsWith(':') && !identities[0].endsWith(':')
    ? `contact:${identities[0]}`
    : null;
}

/** 이름·전화로만 고객을 맺을 때 후보를 DB 에서 좁히는 데 쓰는 전화 숫자 */
export function customerPhoneDigits(value: string | null): string {
  return normalizedPhone(value);
}

/** consolidationCustomerKey 가 이름에 쓰는 정규화와 같다 */
export function customerContactName(value: string | null): string {
  return normalizedText(value);
}

export type ConsolidationOptionReason =
  | 'ok'
  | 'memo_differs'
  | 'address_differs'
  | 'incomplete_recipient'
  | 'unknown_customer';

export interface ConsolidationOptionInput {
  sourceRecipient: unknown;
  sourceCustomerKey: string | null;
  optionRecipient: unknown;
  optionCustomerKey: string | null;
}

function withoutNote(recipient: Record<string, unknown>): string {
  const rest = { ...recipient };
  delete rest.deliveryNote;
  return JSON.stringify(rest);
}

export function classifyConsolidationOption(input: ConsolidationOptionInput): {
  reason: ConsolidationOptionReason;
  selectable: boolean;
} {
  const verdict = (reason: ConsolidationOptionReason) => ({
    reason,
    selectable: reason === 'ok' || reason === 'memo_differs',
  });
  if (!input.sourceCustomerKey || !input.optionCustomerKey) return verdict('unknown_customer');
  const source = canonicalConsolidationRecipient(input.sourceRecipient);
  const option = canonicalConsolidationRecipient(input.optionRecipient);
  if (!source || !option) return verdict('incomplete_recipient');
  if (withoutNote(source) !== withoutNote(option)) return verdict('address_differs');
  if (source.deliveryNote !== option.deliveryNote) return verdict('memo_differs');
  return verdict('ok');
}

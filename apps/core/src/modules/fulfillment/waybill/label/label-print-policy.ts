import type { LabelItem } from './label-items';

export interface LabelPrintRecord {
  fingerprint: string;
  revision: number;
  itemsSnapshot: LabelItem[];
  printedAt: Date;
}

/** 판차(스펙 §10.3): 같은 지문의 기록이 있으면 그 번호, 없으면 최대 판차 + 1(첫 판 1). */
export function revisionFor(
  prints: readonly Pick<LabelPrintRecord, 'fingerprint' | 'revision'>[],
  fingerprint: string,
): number {
  const same = prints.find((p) => p.fingerprint === fingerprint);
  if (same) return same.revision;
  return prints.reduce((max, p) => Math.max(max, p.revision), 0) + 1;
}

/** 마지막으로 출력이 확인된 판 — printed_at 기준. 같은 내용을 다시 출력하면 그 행의 printed_at 이 갱신된다. */
export function latestPrint<T extends Pick<LabelPrintRecord, 'printedAt' | 'revision'>>(
  prints: readonly T[],
): T | null {
  return prints.reduce<T | null>(
    (latest, p) =>
      !latest ||
      p.printedAt.getTime() > latest.printedAt.getTime() ||
      (p.printedAt.getTime() === latest.printedAt.getTime() && p.revision > latest.revision)
        ? p
        : latest,
    null,
  );
}

export type LabelState = 'current' | 'never_printed' | 'reprint_required' | 'not_started' | 'external' | 'unavailable';

export interface LabelItemChange {
  locationCode: string;
  skuId: string;
  name: string;
  printedQty: number;
  currentQty: number;
}

export interface LabelStateView {
  state: LabelState;
  changes: LabelItemChange[];
  /** unavailable 의 사유 코드(`WAYBILL_STALE` 등). 그 밖엔 null. */
  issue: string | null;
}

const keyOf = (i: Pick<LabelItem, 'locationCode' | 'skuId'>) => `${i.locationCode}\u0000${i.skuId}`;
const codepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** «바뀐 줄»(스펙 §10.5) — (로케이션, SKU) 로 맞춰 수량이 다른 줄만. 사라진 줄은 currentQty 0, 새 줄은 printedQty 0. */
export function diffLabelItems(printed: readonly LabelItem[], current: readonly LabelItem[]): LabelItemChange[] {
  const rows = new Map<string, LabelItemChange>();
  for (const i of printed) {
    rows.set(keyOf(i), {
      locationCode: i.locationCode,
      skuId: i.skuId,
      name: i.name,
      printedQty: i.quantity,
      currentQty: 0,
    });
  }
  for (const i of current) {
    const prev = rows.get(keyOf(i));
    if (prev) prev.currentQty = i.quantity;
    else
      rows.set(keyOf(i), {
        locationCode: i.locationCode,
        skuId: i.skuId,
        name: i.name,
        printedQty: 0,
        currentQty: i.quantity,
      });
  }
  return [...rows.values()]
    .filter((row) => row.printedQty !== row.currentQty)
    .sort((a, b) => codepoint(a.locationCode, b.locationCode) || codepoint(a.skuId, b.skuId));
}

export type CurrentLabelSummary =
  | { kind: 'printable'; fingerprint: string; items: LabelItem[] }
  | { kind: 'external' }
  | { kind: 'unavailable'; issue: string };

/** 송장 스캔 상태(스펙 §10.5 + 사용자 결정 external). 조회 전용 — 아무것도 바꾸지 않는다. */
export function labelStateOf(input: {
  batchStarted: boolean;
  current: CurrentLabelSummary;
  prints: readonly LabelPrintRecord[];
}): LabelStateView {
  if (!input.batchStarted) return { state: 'not_started', changes: [], issue: null };
  if (input.current.kind === 'external') return { state: 'external', changes: [], issue: null };
  if (input.current.kind === 'unavailable') return { state: 'unavailable', changes: [], issue: input.current.issue };
  const latest = latestPrint(input.prints);
  if (!latest) return { state: 'never_printed', changes: [], issue: null };
  if (latest.fingerprint === input.current.fingerprint) return { state: 'current', changes: [], issue: null };
  return { state: 'reprint_required', changes: diffLabelItems(latest.itemsSnapshot, input.current.items), issue: null };
}

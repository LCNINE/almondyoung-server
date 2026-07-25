/**
 * sku_barcodes.packing_unit 은 "몇 개입"이라는 숫자인데 컬럼은 varchar(64) 다.
 * 컬럼 타입을 좁히는 건 ADR-0005 상 3-PR expand-contract 라 별도 작업으로 미뤘고,
 * 대신 이 두 함수를 varchar 와 number 계약 사이의 유일한 경계로 둔다.
 * 파싱은 방어적이다 — 컬럼이 varchar 인 한 손으로 'BOX' 같은 값이 들어갈 수 있고,
 * 소비자(현장 앱의 스캔 누적)가 NaN 을 만나면 수량이 조용히 망가진다.
 */
export function parsePackingUnit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function serializePackingUnit(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

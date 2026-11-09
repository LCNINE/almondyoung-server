/**
 * 셀메이트 선반 코드(sku_shelf_positions 의 고유 코드) → 판매 창고 로케이션 마스터 계획 (#1235).
 * DB 를 읽지 않는 순수 함수다. 적용은 build-location-master.ts.
 *
 * - 랙은 데이터에 나온 것만 만든다. 상품이 없는 랙은 칸 수를 알 길이 없어서, 칸 수를 아는 사람이 API 로 만든다.
 *   열 안의 빠진 랙 번호는 보고만 한다(missingRackNumbers).
 * - 칸은 1번부터 그 랙의 가장 큰 숫자 칸까지 빠짐없이(빈 칸에도 자석이 있다). 숫자 칸 없이 커스텀 칸만 있으면 binEnd=null.
 */
import { readShelfCode } from '../../apps/core/src/modules/inventory/core/shelf-code-reading';

export type RackPlan = { column: string; rackNumber: number; binEnd: number | null; customBins: string[] };

export type LocationMasterPlan = {
  columns: string[];
  racks: RackPlan[];
  missingRackNumbers: { column: string; rackNumbers: number[] }[];
  fixed: { raw: string; code: string; rule: 'zero-pad' | 'dash-position'; skuCount: number }[];
  customBins: { raw: string; code: string; skuCount: number }[];
  exceptions: { raw: string; skuCount: number }[];
};

export function planLocationMaster(rows: { positionCode: string; skuCount: number }[]): LocationMasterPlan {
  const racks = new Map<string, RackPlan>();
  const plan: LocationMasterPlan = { columns: [], racks: [], missingRackNumbers: [], fixed: [], customBins: [], exceptions: [] };

  for (const { positionCode, skuCount } of rows) {
    const reading = readShelfCode(positionCode);
    if (reading.kind === 'exception') {
      plan.exceptions.push({ raw: reading.raw, skuCount });
      continue;
    }
    const key = `${reading.column}\u0000${reading.rackNumber}`;
    const rack = racks.get(key) ?? { column: reading.column, rackNumber: reading.rackNumber, binEnd: null, customBins: [] };
    racks.set(key, rack);

    if (reading.kind === 'custom-bin') {
      if (!rack.customBins.includes(reading.bin)) rack.customBins.push(reading.bin);
      plan.customBins.push({ raw: positionCode, code: reading.code, skuCount });
      continue;
    }
    const n = Number.parseInt(reading.bin, 10);
    rack.binEnd = Math.max(rack.binEnd ?? 0, n);
    if (reading.kind === 'fixed') plan.fixed.push({ raw: positionCode, code: reading.code, rule: reading.rule, skuCount });
  }

  plan.racks = [...racks.values()].sort((a, b) =>
    a.column === b.column ? a.rackNumber - b.rackNumber : a.column.localeCompare(b.column),
  );
  plan.columns = [...new Set(plan.racks.map((r) => r.column))].sort();
  for (const column of plan.columns) {
    const have = new Set(plan.racks.filter((r) => r.column === column).map((r) => r.rackNumber));
    const max = Math.max(...have);
    const missing: number[] = [];
    for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
    if (missing.length > 0) plan.missingRackNumbers.push({ column, rackNumbers: missing });
  }
  return plan;
}

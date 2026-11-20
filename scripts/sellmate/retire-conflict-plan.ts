/**
 * 짝 표의 code_barcode_conflict 정리 계획 — DB 를 읽지 않는 순수 함수. 적용은 retire-conflict-skus.ts.
 *
 * 충돌 행마다 셀메이트 바코드를 들고 있는 core SKU(보유자)가 하나 있다.
 *   - 보유자가 짝 표 어디에도 SKU 로 안 나오면 셀메이트에서 내린 예전 품목이다 → 재고를 0 으로 내리고 바코드를 뗀다(retire)
 *   - 보유자가 다른 셀메이트 품목의 짝이면 지금 파는 품목이 남의 바코드를 들고 있는 것이다 → 그 바코드만 뗀다(unbarcode)
 * 물류팀장 판정(동일·상이 모두 «예전 품목 실물 없음», 2-2 는 A)이 이 두 갈래와 같아서 목록을 손으로 적지 않는다.
 */

export type ConflictRow = { optionSerial: string; itemName: string; barcode: string };

export type Holder = {
  skuId: string;
  code: string;
  name: string;
  barcode: string;
  isPrimary: boolean;
  /** 이 SKU 의 바코드 개수(뗄 것 포함) */
  barcodeCount: number;
  onHandBucheon: number;
  onHandElsewhere: number;
  openReservations: number;
};

export type PlanRow = {
  kind: 'retire' | 'unbarcode';
  optionSerial: string;
  itemName: string;
  barcode: string;
  holder: Holder;
  /** retire 일 때 부천 ON_HAND 에서 뺄 양(0 이상) */
  take: number;
};

export type Plan = { rows: PlanRow[]; noHolder: ConflictRow[]; blockers: string[] };

export function planRetire(
  conflicts: readonly ConflictRow[],
  holderByBarcode: ReadonlyMap<string, Holder>,
  pairedSkuIds: ReadonlySet<string>,
): Plan {
  const rows: PlanRow[] = [];
  const noHolder: ConflictRow[] = [];
  const blockers: string[] = [];

  for (const c of conflicts) {
    const holder = holderByBarcode.get(c.barcode);
    if (!holder) {
      noHolder.push(c);
      continue;
    }

    const kind = pairedSkuIds.has(holder.skuId) ? 'unbarcode' : 'retire';
    const take = kind === 'retire' ? Math.max(0, holder.onHandBucheon) : 0;
    rows.push({ kind, optionSerial: c.optionSerial, itemName: c.itemName, barcode: c.barcode, holder, take });

    if (kind === 'retire' && holder.openReservations > 0) {
      blockers.push(`${holder.code} 에 열린 예약 ${holder.openReservations}건 — 재고를 내리면 가용이 음수가 된다`);
    }
    if (kind === 'retire' && holder.onHandElsewhere !== 0) {
      blockers.push(`${holder.code} 에 부천 밖 ON_HAND ${holder.onHandElsewhere} — 이 스크립트는 부천만 내린다`);
    }
    if (kind === 'retire' && holder.onHandBucheon < 0) {
      blockers.push(`${holder.code} 의 부천 ON_HAND 가 음수(${holder.onHandBucheon}) — 사람이 본다`);
    }
    if (kind === 'unbarcode' && holder.isPrimary && holder.barcodeCount > 1) {
      blockers.push(`${holder.code} 에서 대표 바코드 ${c.barcode} 를 떼면 대표가 없어진다 — 남길 대표를 먼저 정한다`);
    }
  }

  return { rows, noHolder, blockers };
}

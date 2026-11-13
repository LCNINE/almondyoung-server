/**
 * 셀메이트 엑셀의 «바코드번호(서식)» 열은 값을 ="…" 수식으로 감싸 내보낸다. 그대로 가져온 행을 정리하는 계획.
 * DB 를 모르는 순수 함수라 스펙으로 갈래를 고정한다.
 */

const FORMULA = /^="([^"]*)"$/;

/** ="10579820000" → 10579820000. 수식 꼴이 아니면 그대로 돌려준다 */
export function unwrapFormula(value: string): string {
  const match = FORMULA.exec(value);

  return match ? match[1].trim() : value;
}

export function isFormula(value: string): boolean {
  return FORMULA.test(value);
}

export interface BarcodeRow {
  id: string;
  skuId: string;
  barcode: string;
  isPrimary: boolean;
  packingUnit: number | null;
}

export interface FormulaBarcodePlan {
  /** 같은 SKU 에 정상 값이 이미 있어 지울 수식 꼴 행 */
  deletes: BarcodeRow[];
  /** 정상 값이 없어 벗긴 값으로 고칠 행 */
  updates: { row: BarcodeRow; to: string }[];
  /** 지우는 행이 들고 있던 대표·상자 수량을 넘겨받을 정상 행 */
  carries: { to: BarcodeRow; isPrimary: boolean; packingUnit: number | null }[];
  /** 벗긴 값을 다른 SKU 가 이미 쓰고 있어 손대지 않는 행 */
  conflicts: { row: BarcodeRow; ownerSkuId: string }[];
  /** 벗기면 빈 값이 되는 행 */
  empties: BarcodeRow[];
}

/**
 * formulaRows: 수식 꼴 행 전부. cleanRows: 그 행들을 벗긴 값과 같은 바코드를 가진 기존 행.
 */
export function planFormulaBarcodes(formulaRows: readonly BarcodeRow[], cleanRows: readonly BarcodeRow[]): FormulaBarcodePlan {
  const plan: FormulaBarcodePlan = { deletes: [], updates: [], carries: [], conflicts: [], empties: [] };
  const cleanByValue = new Map(cleanRows.map((row) => [row.barcode, row]));
  const claimed = new Map<string, string>();

  for (const row of formulaRows) {
    const value = unwrapFormula(row.barcode);

    if (!value) {
      plan.empties.push(row);
      continue;
    }

    const owner = cleanByValue.get(value);

    if (owner && owner.skuId !== row.skuId) {
      plan.conflicts.push({ row, ownerSkuId: owner.skuId });
      continue;
    }

    if (owner) {
      plan.deletes.push(row);

      const isPrimary = row.isPrimary && !owner.isPrimary;
      const packingUnit = owner.packingUnit === null ? row.packingUnit : null;

      if (isPrimary || packingUnit !== null) {
        plan.carries.push({ to: owner, isPrimary, packingUnit });
      }

      continue;
    }

    const claimer = claimed.get(value);

    if (claimer === undefined) {
      claimed.set(value, row.skuId);
      plan.updates.push({ row, to: value });
    } else if (claimer === row.skuId) {
      plan.deletes.push(row);
    } else {
      plan.conflicts.push({ row, ownerSkuId: claimer });
    }
  }

  return plan;
}

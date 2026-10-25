import { canonicalConsolidationRecipient } from '../services/consolidation.service';
import { supplierShipmentStage } from '../shipment/supplier-shipment-stage';
import type { ShipmentStatus } from '../shipment/shipment-transitions';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { parseCarrierName } from '../waybill/carrier/carrier-names';
import { normalizeTrackingNo } from './supplier-dispatch';
import type { ParsedSupplierRow } from './supplier-sheet.parser';

/** N4 의 오류 코드 그대로. */
export type SupplierRowErrorCode =
  | 'UNKNOWN_ROW_KEY'
  | 'OTHER_SUPPLIER'
  | 'CANCELED'
  | 'NOT_HANDED_OFF'
  | 'IN_RECOVERY'
  | 'ROW_MISMATCH'
  | 'QTY_MISMATCH'
  | 'DUPLICATE_ROW'
  | 'UNKNOWN_CARRIER'
  | 'CARRIER_WITHOUT_TRACKING'
  | 'TRACKING_WITHOUT_CARRIER'
  | 'TRACKING_AND_REASON'
  | 'TRACKING_IN_USE'
  | 'MERGE_RECIPIENT_MISMATCH'
  | 'CORRECTION_PARTIAL'
  | 'REASON_ON_SHIPPED'
  | 'GROUP_HAS_ERROR';

export type SupplierRowVerdictKind = 'ship' | 'merge' | 'unfulfillable' | 'waiting' | 'correct' | 'unchanged' | 'error';

/** 줄 하나의 판정 — 개인정보 없음. `carrier`·`trackingNo` 는 칸에서 읽어 낸 값(정규화 뒤)이 있을 때만. */
export type RowVerdict = {
  rowNumber: number;
  rowKey: string;
  orderNo: string;
  verdict: SupplierRowVerdictKind;
  code?: SupplierRowErrorCode;
  carrier?: CarrierCode;
  trackingNo?: string;
};

/** 적용(Task 10)이 실행하는 것의 전부. `lineIds` 는 shipment_line id(행 키 FOI 에서 풀었다). */
export type SupplierApplyPlan = {
  shipGroups: {
    carrier: CarrierCode;
    trackingNo: string;
    boxes: { shipmentId: string; lineIds: string[] }[];
  }[];
  corrections: { shipmentId: string; carrier: CarrierCode; trackingNo: string }[];
  reports: { shipmentLineId: string; reason: string }[];
};

export type JudgeFoi = { qty: number; shippedQty: number; canceledQty: number };
/** 한 FOI 의 살아 있는 입점사 라인(N3) — canceled·superseded 가 아닌 입점사 상자의 라인 */
export type JudgeLine = {
  lineId: string;
  shipmentId: string;
  qty: number;
  orderNo: string;
  /** 그 상자 입점사가 아니라 «올린 입점사»와의 `sku_suppliers.supplier_sku` — 시트가 실은 값과 같은 식 */
  supplierSku: string | null;
  unfulfillableReason: string | null;
};
export type JudgeBox = {
  id: string;
  status: ShipmentStatus;
  supplierId: string | null;
  supplierHandoffId: string | null;
  recoveryCode: string | null;
  recipientSnapshot: unknown;
};
/** 판정이 읽는 DB 사실 전부 — 로더(`supplier-sheet.judge.ts`)가 채운다. 키는 소문자 uuid. */
export type JudgeContext = {
  supplierId: string;
  fois: ReadonlyMap<string, JudgeFoi>;
  lineByFoi: ReadonlyMap<string, JudgeLine>;
  boxes: ReadonlyMap<string, JudgeBox>;
  /** 발송된 상자의 지금 송장(status `used`) */
  usedWaybillByBox: ReadonlyMap<string, { carrier: CarrierCode; trackingNo: string | null }>;
  /** 정규화된 송장번호 → 그 번호의 살아 있는(종결 아닌) 송장이 달린 상자들(상자 없는 송장은 null) */
  liveTrackingBoxes: ReadonlyMap<string, readonly (string | null)[]>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 행 키(FOI id)를 비교 형태(소문자)로 — uuid 가 아니면 null. */
export function rowKeyOf(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return UUID_RE.test(key) ? key : null;
}

/** FOI 미결 0 — 취소(또는 구성 변경으로 수요 0). 다 보낸 FOI 는 취소가 아니다. */
function isCanceled(foi: JudgeFoi): boolean {
  const open = foi.qty - foi.shippedQty - foi.canceledQty;
  return open <= 0 && (foi.qty === 0 || foi.shippedQty < foi.qty);
}

type Stage = SupplierRowVerdictKind | 'shipCandidate' | 'correctCandidate';
type Work = {
  row: ParsedSupplierRow;
  trackingNo: string;
  carrier: CarrierCode | null;
  reason: string;
  line: JudgeLine | null;
  box: JudgeBox | null;
  /** 상자가 발송됨 — 입점사 상자 단계의 단 하나의 정의(`supplierShipmentStage`)로 판정한다 */
  shipped: boolean;
  stage: Stage;
  code?: SupplierRowErrorCode;
};

function fail(w: Work, code: SupplierRowErrorCode): void {
  w.stage = 'error';
  w.code = code;
}

/**
 * 행 키의 살아 있는 입점사 라인과 그 상자를 붙인다. 상자 단계는 `supplierShipmentStage` 로 — 입점사 상자가 타지 않는
 * 상태(planned·in_transit·delivered·failed)는 거기서 Error 로 던진다. 살아 있는 라인 로더가 canceled·superseded 를
 * 빼므로 단계 null 도 프로그래밍 오류다.
 */
function locate(w: Work, ctx: JudgeContext, key: string): { line: JudgeLine; box: JudgeBox } | null {
  const line = ctx.lineByFoi.get(key);
  if (!line) return null;
  const box = ctx.boxes.get(line.shipmentId);
  if (!box) throw new Error(`Supplier sheet judge: shipment ${line.shipmentId} of line ${line.lineId} was not loaded`);
  const stage = supplierShipmentStage(box);
  if (stage === null) throw new Error(`Supplier sheet judge: shipment ${box.id} (${box.status}) is not a live box`);
  w.line = line;
  w.box = box;
  w.shipped = stage === 'shipped';
  return { line, box };
}

/** 줄 혼자 볼 수 있는 판정 — 묶음·정정 판정은 뒤에서. */
function judgeAlone(w: Work, ctx: JudgeContext, keyCount: ReadonlyMap<string, number>): void {
  const { row } = w;
  const key = rowKeyOf(row.rowKey);
  if (!key) return fail(w, 'UNKNOWN_ROW_KEY');
  // 중복 줄도 상자에 붙여 둔다 — 그 상자의 정정·발송 묶음을 오류로 막는다
  const located = locate(w, ctx, key);
  if ((keyCount.get(key) ?? 0) > 1) return fail(w, 'DUPLICATE_ROW');
  const foi = ctx.fois.get(key);
  if (!foi) return fail(w, 'UNKNOWN_ROW_KEY');
  // 통째로 취소된 라인은 묘비 상자로 빠져 살아 있는 라인이 없다
  if (!located) return fail(w, isCanceled(foi) ? 'CANCELED' : 'UNKNOWN_ROW_KEY');
  const { line, box } = located;
  if (box.supplierId !== ctx.supplierId) return fail(w, 'OTHER_SUPPLIER');
  const shipped = w.shipped;
  if (!shipped && isCanceled(foi)) return fail(w, 'CANCELED');
  if (row.orderNo.trim() !== line.orderNo.trim() || row.supplierSku.trim() !== (line.supplierSku ?? '').trim()) {
    return fail(w, 'ROW_MISMATCH');
  }
  if (row.qty !== line.qty) return fail(w, 'QTY_MISMATCH');

  const carrierFilled = row.carrierRaw.trim() !== '';
  if (w.trackingNo && w.reason) return fail(w, 'TRACKING_AND_REASON');
  if (carrierFilled && !w.trackingNo) return fail(w, 'CARRIER_WITHOUT_TRACKING');
  if (w.trackingNo && !carrierFilled) return fail(w, 'TRACKING_WITHOUT_CARRIER');
  if (w.trackingNo && !w.carrier) return fail(w, 'UNKNOWN_CARRIER');

  if (shipped) {
    if (w.reason) return fail(w, 'REASON_ON_SHIPPED');
    if (!w.trackingNo) {
      w.stage = 'waiting';
      return;
    }
    const current = ctx.usedWaybillByBox.get(box.id);
    w.stage =
      current && current.carrier === w.carrier && current.trackingNo === w.trackingNo
        ? 'unchanged'
        : 'correctCandidate';
    return;
  }
  // 단계 함수가 draft·recovery_required 만 열린 단계로 돌려준다 — 남은 것은 draft 다
  if (box.recoveryCode !== null || box.status === 'recovery_required') return fail(w, 'IN_RECOVERY');
  if (box.supplierHandoffId === null) return fail(w, 'NOT_HANDED_OFF');
  if (w.reason) {
    w.stage = line.unfulfillableReason === w.reason ? 'unchanged' : 'unfulfillable';
    return;
  }
  // N8 — 빈 줄은 기존 «못 보냄» 기록을 지우지 않는다
  w.stage = w.trackingNo ? 'shipCandidate' : 'waiting';
}

type CorrectionClaim = { box: JudgeBox; carrier: CarrierCode; trackingNo: string; works: Work[] };

/**
 * 발송된 상자마다 — 정정은 상자 단위로 전부 아니면 전무다(N4, 발송 묶음과 같은 전파): 그 상자의 줄 하나라도 오류면
 * 나머지 줄은 GROUP_HAS_ERROR, 오류 없이 모두 같은 새 송장일 때만 정정, 아니면 그 줄 전부 CORRECTION_PARTIAL.
 */
function claimCorrections(works: readonly Work[]): CorrectionClaim[] {
  const byBox = new Map<string, Work[]>();
  for (const w of works) {
    if (!w.box || !w.shipped) continue;
    byBox.set(w.box.id, [...(byBox.get(w.box.id) ?? []), w]);
  }
  const claims: CorrectionClaim[] = [];
  for (const allWorks of byBox.values()) {
    if (!allWorks.some((w) => w.stage === 'correctCandidate')) continue;
    const boxWorks = allWorks.filter((w) => w.stage !== 'error');
    if (boxWorks.length !== allWorks.length) {
      for (const w of boxWorks) fail(w, 'GROUP_HAS_ERROR');
      continue;
    }
    const targets = new Set(
      boxWorks.map((w) => (w.stage === 'correctCandidate' ? `${w.carrier}|${w.trackingNo}` : '')),
    );
    const [first] = boxWorks;
    if (targets.size === 1 && first.stage === 'correctCandidate' && first.box && first.carrier) {
      claims.push({ box: first.box, carrier: first.carrier, trackingNo: first.trackingNo, works: boxWorks });
    } else {
      for (const w of boxWorks) fail(w, 'CORRECTION_PARTIAL');
    }
  }
  return claims;
}

/**
 * (택배사, 송장) 묶음 — 송장번호가 같은 줄 전부(오류 줄 포함, 발송된 상자 줄 제외). 묶음은 전부 적용하거나 전부 오류다(N4):
 * 일부만 합쳐 보내면 남은 줄이 다음 파일에서 TRACKING_IN_USE 로 영영 막힌다.
 */
function groupByTracking(works: readonly Work[]): Map<string, Work[]> {
  const groups = new Map<string, Work[]>();
  for (const w of works) {
    if (!w.trackingNo || w.shipped) continue;
    if (w.stage !== 'shipCandidate' && w.stage !== 'error') continue;
    groups.set(w.trackingNo, [...(groups.get(w.trackingNo) ?? []), w]);
  }
  for (const [trackingNo, members] of groups) {
    if (!members.some((w) => w.stage === 'shipCandidate')) groups.delete(trackingNo);
  }
  return groups;
}

const byString =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a).localeCompare(key(b));

/** 줄 판정(N4) — 미리보기와 적용이 같은 함수를 쓴다. DB 를 읽지도 쓰지도 않는다. */
export function classifySupplierRows(
  rows: readonly ParsedSupplierRow[],
  ctx: JudgeContext,
): { rows: RowVerdict[]; plan: SupplierApplyPlan } {
  const keyCount = new Map<string, number>();
  for (const row of rows) {
    const key = rowKeyOf(row.rowKey);
    if (key) keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  const works: Work[] = rows.map((row) => {
    const w: Work = {
      row,
      trackingNo: normalizeTrackingNo(row.trackingNo),
      carrier: row.carrierRaw.trim() ? parseCarrierName(row.carrierRaw) : null,
      reason: row.reason.trim(),
      line: null,
      box: null,
      shipped: false,
      stage: 'error',
    };
    judgeAlone(w, ctx, keyCount);
    return w;
  });

  const corrections = claimCorrections(works);
  const groups = groupByTracking(works);
  // 한 번호를 노리는 단위(발송 묶음·정정 상자)가 둘 이상이면 적용 중 두 번째가 살아 있는 번호에 막힌다
  const claimsOf = new Map<string, number>();
  for (const trackingNo of groups.keys()) claimsOf.set(trackingNo, 1);
  for (const c of corrections) claimsOf.set(c.trackingNo, (claimsOf.get(c.trackingNo) ?? 0) + 1);
  const contested = (trackingNo: string) => (claimsOf.get(trackingNo) ?? 0) > 1;

  const plan: SupplierApplyPlan = { shipGroups: [], corrections: [], reports: [] };
  for (const [trackingNo, members] of groups) {
    const candidates = members.filter((w) => w.stage === 'shipCandidate');
    const failAll = (code: SupplierRowErrorCode) => candidates.forEach((w) => fail(w, code));
    if (candidates.length !== members.length) {
      failAll('GROUP_HAS_ERROR');
      continue;
    }
    const carriers = new Set(candidates.map((w) => w.carrier));
    const live = ctx.liveTrackingBoxes.get(trackingNo) ?? [];
    // 같은 번호에 택배사가 둘이면 한쪽은 그 번호의 살아 있는 송장에 막힌다
    if (carriers.size > 1 || contested(trackingNo) || live.length > 0) {
      failAll('TRACKING_IN_USE');
      continue;
    }
    const lineIdsByBox = new Map<string, string[]>();
    const boxById = new Map<string, JudgeBox>();
    for (const w of candidates) {
      if (!w.box || !w.line) throw new Error('Supplier sheet judge: ship candidate without a box');
      boxById.set(w.box.id, w.box);
      lineIdsByBox.set(w.box.id, [...(lineIdsByBox.get(w.box.id) ?? []), w.line.lineId]);
    }
    if (boxById.size > 1) {
      const recipients = [...boxById.values()].map((box) => canonicalConsolidationRecipient(box.recipientSnapshot));
      const first = JSON.stringify(recipients[0]);
      if (recipients.some((r) => r === null || JSON.stringify(r) !== first)) {
        failAll('MERGE_RECIPIENT_MISMATCH');
        continue;
      }
    }
    const verdict = boxById.size > 1 ? 'merge' : 'ship';
    for (const w of candidates) w.stage = verdict;
    const [carrier] = carriers;
    if (!carrier) throw new Error('Supplier sheet judge: ship group without a carrier');
    plan.shipGroups.push({
      carrier,
      trackingNo,
      boxes: [...lineIdsByBox.entries()]
        .map(([shipmentId, lineIds]) => ({ shipmentId, lineIds: [...lineIds].sort() }))
        .sort(byString((b) => b.shipmentId)),
    });
  }

  for (const c of corrections) {
    const live = (ctx.liveTrackingBoxes.get(c.trackingNo) ?? []).filter((boxId) => boxId !== c.box.id);
    if (contested(c.trackingNo) || live.length > 0) {
      c.works.forEach((w) => fail(w, 'TRACKING_IN_USE'));
      continue;
    }
    c.works.forEach((w) => (w.stage = 'correct'));
    plan.corrections.push({ shipmentId: c.box.id, carrier: c.carrier, trackingNo: c.trackingNo });
  }

  for (const w of works) {
    if (w.stage === 'unfulfillable' && w.line) plan.reports.push({ shipmentLineId: w.line.lineId, reason: w.reason });
  }
  plan.shipGroups.sort((a, b) => a.trackingNo.localeCompare(b.trackingNo) || a.carrier.localeCompare(b.carrier));
  plan.corrections.sort(byString((c) => c.shipmentId));
  plan.reports.sort(byString((r) => r.shipmentLineId));

  return { rows: works.map(toVerdict), plan };
}

function toVerdict(w: Work): RowVerdict {
  if (w.stage === 'shipCandidate' || w.stage === 'correctCandidate') {
    throw new Error(`Supplier sheet row ${w.row.rowNumber} was left undecided (${w.stage})`);
  }
  return {
    rowNumber: w.row.rowNumber,
    rowKey: w.row.rowKey.trim(),
    orderNo: w.row.orderNo.trim(),
    verdict: w.stage,
    ...(w.code ? { code: w.code } : {}),
    ...(w.carrier ? { carrier: w.carrier } : {}),
    ...(w.trackingNo ? { trackingNo: w.trackingNo } : {}),
  };
}

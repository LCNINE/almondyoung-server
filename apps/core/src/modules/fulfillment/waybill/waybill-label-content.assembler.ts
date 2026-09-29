import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbTx } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { buildHanjinLabelContent, type HanjinLabelContent } from './carrier/hanjin/label/hanjin-label-data';
import { assertContextMatchesWaybill, assertLabelAvailable } from './label/label-guards';
import { labelFingerprint } from './label/label-fingerprint';
import { labelItemsOf } from './label/label-items';
import { WAYBILL } from './waybill.constants';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { HANJIN_CONFIG } from './waybill.tokens';
import type { LabelAllocation, WaybillRow } from './waybill.types';

export interface PrintableLabel {
  kind: 'printable';
  waybill: WaybillRow;
  workItemId: string;
  content: HanjinLabelContent;
  fingerprint: string;
}
export type CurrentLabel = { kind: 'external'; waybill: WaybillRow } | PrintableLabel;

/** 앱이 그릴 수 있는 송장인가 — 한진이 발급한 것만(그 밖은 I4·I5 면제, labelState external). */
export function isAppPrintable(wb: Pick<WaybillRow, 'source' | 'carrier'>): boolean {
  return wb.source === 'carrier' && wb.carrier === 'HANJIN';
}

/**
 * I4 — 시작된 배치의 작업 항목(활성 작업 항목, 없으면 출고 완료된 마지막 작업 항목 — 재출력용)이면서 배정 합이
 * 줄 수량을 덮은 박스만 그린다. `excluded` 만 남은 박스는 작업 항목이 없는 것으로 보고 거절한다.
 */
export function assertLabelAllocated(
  shipmentId: string,
  allocation: LabelAllocation,
): asserts allocation is LabelAllocation & { workItemId: string } {
  if (!allocation.workItemId || !allocation.batchStarted) {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_NOT_ALLOCATED}: shipment ${shipmentId} is not in a started batch`);
  }
  const allocated = new Map<string, number>();
  for (const row of allocation.rows) {
    allocated.set(row.shipmentLineId, (allocated.get(row.shipmentLineId) ?? 0) + row.qty);
  }
  const short = allocation.lines.find((line) => (allocated.get(line.id) ?? 0) < line.qty);
  if (short) {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_NOT_ALLOCATED}: shipment line ${short.id} is not fully allocated`);
  }
}

export function requirePrintable(current: CurrentLabel): PrintableLabel {
  if (current.kind === 'printable') return current;
  assertLabelAvailable(current.waybill); // external 이면 여기서 WAYBILL_LABEL_UNAVAILABLE 로 던진다
  throw new Error(`waybill ${current.waybill.id} classified external but passed assertLabelAvailable`);
}

/**
 * «현재 내용 조립»의 단일 지점(스펙 §10.4 끝). 렌더러·출력 확인·재출력 게이트·송장 스캔 상태가 모두 이 함수를
 * 부른다 — 그리는 입력과 비교하는 입력이 같은 객체에서 나오므로 둘이 어긋나지 않는다.
 */
@Injectable()
export class WaybillLabelContentAssembler {
  constructor(
    private readonly waybills: WaybillManager,
    private readonly reader: WaybillReader,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
  ) {}

  async current(shipmentId: string, trx: DbTx): Promise<CurrentLabel> {
    const waybill = await this.waybills.assertDispatchable(shipmentId, trx);
    if (!isAppPrintable(waybill)) return { kind: 'external', waybill };
    assertLabelAvailable(waybill);
    const ctx = await this.reader.loadIssueContext(trx, shipmentId);
    assertContextMatchesWaybill(waybill, ctx, (snapshot) => this.reader.recipientHashOf(snapshot));
    const allocation = await this.reader.loadLabelAllocation(trx, shipmentId);
    assertLabelAllocated(shipmentId, allocation);
    const content = buildHanjinLabelContent({
      waybill,
      ctx,
      config: this.config,
      items: labelItemsOf(allocation.rows),
    });
    return {
      kind: 'printable',
      waybill,
      workItemId: allocation.workItemId,
      content,
      fingerprint: labelFingerprint(content),
    };
  }
}

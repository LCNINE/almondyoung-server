import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import type { ManifestEditDeps } from '../shipment/shipment-manifest-edit';
import { WaybillRepository } from '../waybill/waybill.repository';
import { shipSupplierShipment, type SupplierDispatchDeps } from './supplier-dispatch';
import { correctSupplierWaybill, reportUnfulfillable } from './supplier-line-reports';
import { mergeSupplierShipments, splitOffSupplierLines, type ManifestActor } from './supplier-manifest';
import {
  judgeSupplierSheet,
  type RowVerdict,
  type SupplierApplyPlan,
  type SupplierRowVerdictKind,
} from './supplier-sheet.judge';
import { parseSupplierSheet } from './supplier-sheet.parser';
import { SupplierUploadPreviewStaleError } from './supplier-shipment.errors';

/** 판정 종류마다 줄 수 — 0 인 종류도 싣는다. */
export type SupplierSheetVerdictCounts = Record<SupplierRowVerdictKind, number>;

export type SupplierSheetPreview = { rows: RowVerdict[]; counts: SupplierSheetVerdictCounts; token: string };
export type SupplierSheetApplyResult = { counts: SupplierSheetVerdictCounts; shippedShipmentIds: string[] };

export function countVerdicts(rows: readonly RowVerdict[]): SupplierSheetVerdictCounts {
  const counts: SupplierSheetVerdictCounts = {
    ship: 0,
    merge: 0,
    unfulfillable: 0,
    waiting: 0,
    correct: 0,
    unchanged: 0,
    error: 0,
  };
  for (const row of rows) counts[row.verdict] += 1;
  return counts;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 나눈·합친 새 상자의 `opened_by`(uuid 칸)로 남길 사람 — 플랫폼 사용자 id 는 user-service `users.id`(uuid) 지만
 * 토큰이 uuid 를 보장하지 않으므로, uuid 가 아니면 남기지 않는다(나누기는 원래 상자의 값을 물려받는다).
 */
function manifestActorOf(actorId: string): ManifestActor | undefined {
  return UUID_RE.test(actorId) ? { actorId } : undefined;
}

type ApplyDeps = { manifest: ManifestEditDeps; dispatch: SupplierDispatchDeps };

/**
 * 판정 계획을 실행한다 — 호출자의 트랜잭션 안에서, 판정이 그래프 락을 잡은 뒤에. 실행부는 각자 그래프 락을 다시 잡는다(같은 tx 라 재진입).
 * 순서: 발송 묶음마다 상자별로 묶음의 라인을 떼어(상자 전부면 그대로) → 상자가 둘 이상이면 합포장 → 발송. 그 뒤 정정, 그 뒤 «못 보냄».
 * «못 보냄» 라인은 나누기에서 원래 상자에 남으므로(라인 id 그대로) 발송·합포장 뒤에도 같은 id 로 찾는다.
 */
async function executePlan(
  deps: ApplyDeps,
  tx: DbTx,
  plan: SupplierApplyPlan,
  actorId: string,
  at: Date,
): Promise<string[]> {
  const actor = manifestActorOf(actorId);
  const shipped: string[] = [];
  for (const group of plan.shipGroups) {
    const boxIds: string[] = [];
    for (const box of group.boxes) {
      boxIds.push(await splitOffSupplierLines(deps.manifest, tx, box.shipmentId, box.lineIds, actor));
    }
    const finalId = boxIds.length > 1 ? await mergeSupplierShipments(deps.manifest, tx, boxIds, actor) : boxIds[0];
    if (!finalId) throw new Error(`Supplier sheet apply: ship group ${group.trackingNo} has no boxes`);
    await shipSupplierShipment(deps.dispatch, tx, {
      shipmentId: finalId,
      carrier: group.carrier,
      trackingNo: group.trackingNo,
      actorId,
      at,
    });
    shipped.push(finalId);
  }
  for (const correction of plan.corrections) {
    await correctSupplierWaybill(deps.dispatch, tx, { ...correction, actorId, at });
  }
  for (const report of plan.reports) {
    await reportUnfulfillable(tx, { ...report, actorId, at });
  }
  return shipped;
}

/**
 * 입점사가 채워 돌려준 직배 시트 올리기(K3 PR5) — 미리보기와 적용이 같은 판정(`judgeSupplierSheet`, N4)을 쓴다.
 * 적용은 파일 하나를 한 트랜잭션으로(N6): 잠근 뒤 다시 판정해 미리보기 토큰과 같을 때만 계획을 실행하고, 하나라도 실패하면 전부 롤백한다.
 */
@Injectable()
export class SupplierSheetApplyService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservations: ShipmentReservationService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
    private readonly waybills: WaybillRepository,
    @InjectPublisher(SHIPMENT_STREAM) private readonly shipments: PublisherFor<typeof SHIPMENT_STREAM>,
    @InjectPublisher(FULFILLMENT_V2_STREAM)
    private readonly fulfillmentsV2: PublisherFor<typeof FULFILLMENT_V2_STREAM>,
    @InjectPublisher(FULFILLMENT_STREAM) private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    @InjectPublisher(CORE_ORDER_STREAM) private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
  ) {}

  /** 줄 판정과 토큰 — 아무것도 쓰지도 잠그지도 않는다. */
  async preview(supplierId: string, buffer: Buffer, tx?: DbTx): Promise<SupplierSheetPreview> {
    const rows = await parseSupplierSheet(buffer);
    return this.dbService.run(async (trx) => {
      const judged = await judgeSupplierSheet(trx, supplierId, rows, { lock: false });
      return { rows: judged.rows, counts: countVerdicts(judged.rows), token: judged.token };
    }, tx);
  }

  /** 미리보기와 같은 파일·같은 토큰일 때만 계획을 실행한다. 모든 쓰기의 시각은 같다. */
  async apply(
    supplierId: string,
    buffer: Buffer,
    previewToken: string,
    actorId: string,
    tx?: DbTx,
  ): Promise<SupplierSheetApplyResult> {
    const rows = await parseSupplierSheet(buffer);
    return this.dbService.run(async (trx) => {
      // 판정이 그래프 락을 먼저 잡는다 — 그 앞에서 아무것도 잠그지 않는다(공유 락 순서)
      const judged = await judgeSupplierSheet(trx, supplierId, rows, { lock: true });
      if (judged.token !== previewToken) {
        throw new SupplierUploadPreviewStaleError(
          `Supplier ${supplierId} sheet changed since the preview — preview the file again`,
        );
      }
      const shippedShipmentIds = await executePlan(this.deps(), trx, judged.plan, actorId, new Date());
      return { counts: countVerdicts(judged.rows), shippedShipmentIds };
    }, tx);
  }

  /** 실행부가 받는 평범한 객체. 클래스 필드 초기화식에서 만들지 않는다(useDefineForClassFields). */
  private deps(): ApplyDeps {
    return {
      manifest: { invariant: this.invariant, reservations: this.reservations },
      dispatch: {
        shipments: this.shipments,
        fulfillmentsV2: this.fulfillmentsV2,
        fulfillmentsV1: this.fulfillmentsV1,
        coreOrders: this.coreOrders,
        audit: this.audit,
        invariant: this.invariant,
        waybills: this.waybills,
      },
    };
  }
}

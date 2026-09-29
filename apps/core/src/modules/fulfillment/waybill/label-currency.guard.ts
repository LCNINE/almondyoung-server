import { ConflictException, Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { latestPrint } from './label/label-print-policy';
import { WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

/** 조립 실패(`WAYBILL_STALE: …`)를 fulfillment 관례(`{ code }`)로 옮긴다 — 앱은 code 로 문구를 고른다. */
function asCodedConflict(error: unknown): unknown {
  if (!(error instanceof ConflictError)) return error;
  const code = /^([A-Z][A-Z_]+):/.exec(error.message)?.[1];
  return code ? new ConflictException({ code, message: error.message }) : error;
}

/**
 * I5(스펙 §10.4) — 현재 지문 ≠ 마지막 출력 지문이면(출력 안 됨 포함) 박스의 전진 명령을 거절한다.
 * 호출자는 작업 항목을 이미 잠갔고, `commands.execute` 핸들러 **안**에서 부른다 — 멱등 재전송은 핸들러를
 * 다시 돌지 않으므로 막히지 않는다. 앱이 그릴 수 없는 송장(수기·한진 외)은 면제(사용자 결정).
 * 정합성은 «배정된 로케이션만 받는 스캔»이 지키고, 이 게이트는 낡은 종이로 헛걸음하는 것을 막는다(스펙 §5).
 */
@Injectable()
export class LabelCurrencyGuard {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
  ) {}

  async assertCurrent(workItemId: string, trx: DbTx): Promise<void> {
    const [item] = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
      .limit(1);
    if (!item) throw new Error(`LabelCurrencyGuard: work item ${workItemId} vanished under its own lock`);
    const current = await this.assembler.current(item.shipmentId, trx).catch((error: unknown) => {
      throw asCodedConflict(error);
    });
    if (current.kind === 'external') return;
    const latest = latestPrint(await this.prints.listByShipments(trx, [item.shipmentId]));
    if (latest?.fingerprint === current.fingerprint) return;
    throw new ConflictException({
      code: 'LABEL_REPRINT_REQUIRED',
      message: latest
        ? `Shipment ${item.shipmentId} label changed — print the new revision before continuing`
        : `Shipment ${item.shipmentId} label has not been printed yet`,
    });
  }
}

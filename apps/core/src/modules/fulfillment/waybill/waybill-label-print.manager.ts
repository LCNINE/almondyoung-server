import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { revisionFor } from './label/label-print-policy';
import { WAYBILL } from './waybill.constants';
import { requirePrintable, WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

export interface LabelPrintConfirmation {
  fingerprint: string;
  revision: number;
  printedAt: string;
}

/**
 * 출력 확인(스펙 §10.3) — 앱이 프린터 전송에 **성공한 뒤에만** 부른다. 현재 지문과 같을 때만 기록한다.
 * 박스(KEY SHARE) → 활성 작업 항목(FOR UPDATE) 순으로 잠가 줄을 서므로(스펙 §13) 같은 지문의 동시 확인은 한 행·같은
 * 판차가 된다.
 * 알고 남기는 위험: 전송은 성공했는데 용지가 걸린 경우 — 재출력 버튼으로 대응한다.
 */
@Injectable()
export class WaybillLabelPrintManager {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  async confirm(
    shipmentId: string,
    fingerprint: string,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LabelPrintConfirmation> {
    return this.dbService.run(async (trx) => {
      // 잠금 순서는 박스 → 작업 항목(스펙 §13) — 발송(`ShipmentDispatchService.lockAggregate`)과 같다. 출력 기록
      // INSERT 의 FK 검사가 shipments 에 암묵 KEY SHARE 를 잡으므로, 먼저 명시적으로 잡지 않으면 작업 항목 잠금 뒤에
      // 박스 잠금이 와 발송과 교착할 수 있다.
      const shipment = await this.prints.lockShipmentKey(trx, shipmentId);
      if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
      // 순서가 중요하다: 잠금 → 기존 출력 읽기 → 판차 계산. 잠금이 동시 확인을 직렬화하므로
      // 서로 다른 지문 둘이 같은 «기존 출력 목록» 을 보고 같은 판차를 계산하는 일이 없다.
      // 출고된 박스(원장 Ruling F3)는 활성 작업 항목이 없어 null 이다 — 그대로 진행한다. 그 박스의 내용은 완료된
      // 작업 항목의 배정으로 굳어 지문이 하나뿐이고, 같은 지문의 동시 확인은 record 의 upsert 가 한 행으로 모은다.
      await this.prints.lockActiveWorkItem(trx, shipmentId);
      const label = requirePrintable(await this.assembler.current(shipmentId, trx));
      if (label.fingerprint !== fingerprint) {
        throw new ConflictError(
          `${WAYBILL.ERROR.LABEL_CONTENT_CHANGED}: shipment ${shipmentId} label changed since it was rendered`,
        );
      }
      const existing = await this.prints.listByShipments(trx, [shipmentId]);
      const saved = await this.prints.record(trx, {
        shipmentId,
        fingerprint,
        revision: revisionFor(existing, fingerprint),
        itemsSnapshot: label.content.items,
        printedBy: actor.id,
      });
      return { fingerprint: saved.fingerprint, revision: saved.revision, printedAt: saved.printedAt.toISOString() };
    }, tx);
  }
}

import { Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
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
 * 박스의 활성 작업 항목 잠금에서 줄을 서므로(스펙 §13) 같은 지문의 동시 확인은 한 행·같은 판차가 된다.
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
      // 순서가 중요하다: 잠금 → 기존 출력 읽기 → 판차 계산. 잠금이 동시 확인을 직렬화하므로
      // 서로 다른 지문 둘이 같은 «기존 출력 목록» 을 보고 같은 판차를 계산하는 일이 없다.
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

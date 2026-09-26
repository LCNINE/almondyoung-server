import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { buildHanjinLabelData } from './carrier/hanjin/label/hanjin-label-data';
import { renderHanjinNsLabel } from './carrier/hanjin/label/hanjin-ns-template';
import { mmToDots } from './label/label-model';
import { SvgRasterizer } from './label/svg-rasterizer';
import { encodeZpl } from './label/zpl-encoder';
import { WAYBILL } from './waybill.constants';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { HANJIN_CONFIG, WAYBILL_LABEL_CLOCK } from './waybill.tokens';
import type { WaybillRow } from './waybill.types';

export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: 'zpl';
  data: string;
}

/** assertDispatchable 뒤에 거는 라벨 전용 조건(스펙 §5 의 4~6). */
export function assertLabelAvailable(wb: Pick<WaybillRow, 'id' | 'source' | 'carrier' | 'labelData'>): void {
  if (wb.source !== 'carrier') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: manual waybill ${wb.id} has no carrier label data`);
  }
  if (wb.carrier !== 'HANJIN') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: no label template for carrier ${wb.carrier}`);
  }
  if (wb.labelData === null || wb.labelData === undefined) {
    throw new Error(`waybill ${wb.id} was issued by a carrier but has no labelData`);
  }
}

/**
 * 한진 자체출력 운송장 ZPL(#913). 가드는 assertDispatchable 을 그대로 쓴다 — «출력 가능 ⇔ 출고 가능».
 * 라벨은 발급 때의 사본이 아니라 현재 shipment 로 다시 조립하는데, 매니페스트 버전·수하인 해시가
 * 같다는 게 확인됐으므로 한진 등록값과 같다.
 */
@Injectable()
export class WaybillLabelManager {
  constructor(
    private readonly waybills: WaybillManager,
    private readonly reader: WaybillReader,
    private readonly rasterizer: SvgRasterizer,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
    @Optional() @Inject(WAYBILL_LABEL_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  async render(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    const { waybill, ctx } = await this.dbService.run(async (trx) => {
      const waybill = await this.waybills.assertDispatchable(shipmentId, trx);
      assertLabelAvailable(waybill);
      const ctx = await this.reader.loadIssueContext(trx, shipmentId);
      return { waybill, ctx };
    }, tx);

    const spec = renderHanjinNsLabel(buildHanjinLabelData({ waybill, ctx, config: this.config, now: this.now() }));
    const bitmap = this.rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm));
    const data = encodeZpl(bitmap, spec.barcodes, { compress: WAYBILL.LABEL_ZPL_COMPRESS });
    return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '', format: 'zpl', data };
  }
}

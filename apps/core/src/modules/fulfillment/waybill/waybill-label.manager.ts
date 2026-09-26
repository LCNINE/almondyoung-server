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
import type { IssueContext, WaybillRow } from './waybill.types';

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
 * `assertDispatchable` 과 `loadIssueContext` 는 같은 트랜잭션 안이라도 별개 statement 다 — READ COMMITTED
 * 에서는 그 사이 커밋된 수하인 정정이 두 번째 읽기에만 보일 수 있다. 그러면 해시 검사(assertDispatchable)는
 * 통과했는데 실제로 조립하는 라벨은 **새** 주소를 쓰게 되어, 한진에 등록된 값과 달라진다(#913 최종리뷰).
 * `render` 는 `loadIssueContext` 직후 이 함수로 재확인한다.
 */
export function assertContextMatchesWaybill(
  waybill: Pick<WaybillRow, 'id' | 'manifestVersion' | 'recipientHash'>,
  ctx: Pick<IssueContext, 'manifestVersion' | 'recipientSnapshot'>,
  hashOf: (recipientSnapshot: unknown) => string,
): void {
  if (waybill.manifestVersion !== ctx.manifestVersion || waybill.recipientHash !== hashOf(ctx.recipientSnapshot)) {
    throw new ConflictError(
      `${WAYBILL.ERROR.STALE}: waybill ${waybill.id} manifest/recipient changed between guard and assembly`,
    );
  }
}

/**
 * 한진 자체출력 운송장 ZPL(#913). 가드는 assertDispatchable 을 그대로 쓴다 — «출력 가능 ⇔ 출고 가능».
 * 라벨은 발급 때의 사본이 아니라 현재 shipment 로 다시 조립한다. 매니페스트 버전·수하인 해시가 같음을
 * assertDispatchable 과 assertContextMatchesWaybill 두 번 확인하므로 수하인·품명은 한진 등록값과 같다 —
 * 다만 공동현관 비밀번호(⑭ 일부)는 해시 대상이 아니라서 한진에 등록된 시점보다 최신 값을 실을 수 있다
 * (의도된 동작: 그 필드는 최신값을 태우는 게 맞다).
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
      assertContextMatchesWaybill(waybill, ctx, (snapshot) => this.reader.recipientHashOf(snapshot));
      return { waybill, ctx };
    }, tx);

    const spec = renderHanjinNsLabel(buildHanjinLabelData({ waybill, ctx, config: this.config, now: this.now() }));
    const bitmap = this.rasterizer.rasterize(spec.svg, mmToDots(spec.widthMm));
    const data = encodeZpl(bitmap, spec.barcodes, { compress: WAYBILL.LABEL_ZPL_COMPRESS });
    return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '', format: 'zpl', data };
  }
}

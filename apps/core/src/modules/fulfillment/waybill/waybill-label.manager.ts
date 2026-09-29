import { Inject, Injectable, Optional } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { buildHanjinLabelData } from './carrier/hanjin/label/hanjin-label-data';
import { renderHanjinLabel } from './carrier/hanjin/label/hanjin-label-templates';
import { SvgRasterizer } from './label/svg-rasterizer';
import { encodeLabelPages } from './label/label-document';
import { WAYBILL } from './waybill.constants';
import { WaybillLabelContentAssembler, requirePrintable } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';
import { revisionFor } from './label/label-print-policy';
import { HANJIN_CONFIG, WAYBILL_LABEL_CLOCK } from './waybill.tokens';
export { assertContextMatchesWaybill, assertLabelAvailable } from './label/label-guards';

export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: 'zpl';
  /** 쪽마다 ^XA…^XZ 를 이어 붙인 문자열 — 앱은 통째로 인쇄한다. */
  data: string;
  pages: number;
  /** 이 종이의 내용 지문 — 앱이 프린터 전송에 성공한 뒤 출력 확인(POST label-prints)에 그대로 보낸다. */
  fingerprint: string;
  /** 판차. 같은 지문이 출력된 적 있으면 그 번호, 없으면 최대 + 1. GET 이라 계산만 하고 쓰지 않는다. */
  revision: number;
}

/**
 * 한진 자체출력 운송장 ZPL(#913). 형(NS·NL·FS)은 HANJIN_LABEL_TYPE 이 정한다.
 * 가드는 assertDispatchable 을 그대로 쓴다 — «출력 가능 ⇔ 출고 가능».
 * 라벨은 발급 때의 사본이 아니라 현재 shipment 로 다시 조립한다. 매니페스트 버전·수하인 해시가 같음을
 * assertDispatchable 과 assertContextMatchesWaybill 두 번 확인하므로 수하인·품명은 한진 등록값과 같다 —
 * 다만 공동현관 비밀번호(⑭ 일부)는 해시 대상이 아니라서 한진에 등록된 시점보다 최신 값을 실을 수 있다
 * (의도된 동작: 그 필드는 최신값을 태우는 게 맞다).
 */
/**
 * 한진 자체출력 운송장 ZPL(#913). 형(NS·NL·FS)은 HANJIN_LABEL_TYPE 이 정한다.
 * 라벨은 현재 shipment 와 **현재 배정**으로 다시 조립한다. 조립은 `WaybillLabelContentAssembler` 한 곳 —
 * 가드(assertDispatchable·수하인 재확인·I4)와 내용 지문이 거기서 나온다.
 * 공동현관 비밀번호(⑭ 일부)는 해시 대상이 아니라서 한진 등록 시점보다 최신 값을 실을 수 있다
 * (의도된 동작: 그 필드는 최신값을 태우는 게 맞다).
 */
@Injectable()
export class WaybillLabelManager {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    private readonly rasterizer: SvgRasterizer,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
    @Optional() @Inject(WAYBILL_LABEL_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  async render(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    const { label, revision } = await this.dbService.run(async (trx) => {
      const label = requirePrintable(await this.assembler.current(shipmentId, trx));
      const prints = await this.prints.listByShipments(trx, [shipmentId]);
      return { label, revision: revisionFor(prints, label.fingerprint) };
    }, tx);

    const pages = renderHanjinLabel(
      this.config.labelType,
      buildHanjinLabelData({ content: label.content, now: this.now(), revision }),
    );
    const data = encodeLabelPages(pages, this.rasterizer, WAYBILL.LABEL_ZPL_COMPRESS);
    return {
      waybillId: label.waybill.id,
      trackingNo: label.waybill.trackingNo ?? '',
      format: 'zpl',
      data,
      pages: pages.length,
      fingerprint: label.fingerprint,
      revision,
    };
  }
}

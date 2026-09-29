import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import type { HanjinConfig } from '../carrier/hanjin/hanjin.config';
import { SvgRasterizer } from '../label/svg-rasterizer';
import { WaybillLabelContentAssembler } from '../waybill-label-content.assembler';
import { WaybillLabelManager } from '../waybill-label.manager';
import { WaybillLabelPrintRepository } from '../waybill-label-print.repository';
import { WaybillManager } from '../waybill.manager';
import { WaybillReader } from '../waybill.reader';
import { WaybillRepository } from '../waybill.repository';

export const HANJIN_LABEL_DATA = {
  hub_cod: 'NX',
  tml_cod: '150',
  tml_nam: '중구',
  dom_mid: 'Z',
  cen_cod: '1050',
  cen_nam: '해운(집)',
  grp_rnk: 'A1',
  es_nam: '권순천',
  es_cod: '888',
  prt_add: '세종대로 1',
  dom_rgn: '1',
  s_tml_cod: '000',
  s_tml_nam: '본사',
};

export const LABEL_TEST_CONFIG: HanjinConfig = {
  clientId: 'CID',
  apiKey: 'AK',
  secretKey: 'SK',
  contractNo: 'CN',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 15000,
  sender: {
    name: '보내는이',
    zip: '06236',
    baseAddress: '서울특별시 강남구 테헤란로 1',
    detailAddress: '10층',
    tel: '02-100-2000',
  },
  boxType: 'A',
  payType: 'CD',
  labelType: 'FS',
};

/**
 * 공용 출고 픽스처의 수기 송장을 «한진이 발급한» 송장으로 바꾼다 — 수기 송장은 I4·I5 면제라 게이트·렌더를
 * 시험하려면 이게 필요하다. 수하인 해시·매니페스트 버전은 픽스처 값 그대로라 assertDispatchable 을 통과한다.
 */
export async function promoteToCarrierWaybill(
  tx: DbTx,
  fixture: { waybillId: string },
): Promise<{ trackingNo: string }> {
  const trackingNo = String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));
  await tx
    .update(wmsTables.waybills)
    .set({
      source: 'carrier',
      trackingNo,
      custOrdNo: `AY${randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`,
      labelData: HANJIN_LABEL_DATA,
      issuedAt: new Date(),
    })
    .where(eq(wmsTables.waybills.id, fixture.waybillId));
  return { trackingNo };
}

/** 송장 조립·렌더·출력 기록을 한 DbService 위에 배선한다(발급 경로는 stub — 이 경로에서 안 불린다). */
export function assembleLabels(
  dbService: DbService<typeof wmsSchema>,
  now: () => Date = () => new Date('2026-09-30T01:00:00Z'),
) {
  const reader = new WaybillReader(dbService);
  const waybills = new WaybillManager(
    reader,
    new WaybillRepository(dbService),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    dbService,
  );
  const assembler = new WaybillLabelContentAssembler(waybills, reader, LABEL_TEST_CONFIG);
  const prints = new WaybillLabelPrintRepository();
  return {
    assembler,
    prints,
    render: new WaybillLabelManager(assembler, prints, new SvgRasterizer(), LABEL_TEST_CONFIG, dbService, now),
  };
}

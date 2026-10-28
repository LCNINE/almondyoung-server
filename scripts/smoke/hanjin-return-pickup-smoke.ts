/**
 * 한진 반품 회수(R) 예약·취소 스모크. CI 아님 — 사람이 직접 실행한다. (K8 PR9)
 *
 *   npx dotenv -e apps/core/.env -- npx tsx scripts/smoke/hanjin-return-pickup-smoke.ts
 *
 * 가짜 주소로 회수를 예약 → 같은 주문번호로 재예약(already_reserved 가 번호를 되찾는지) → 취소 → 재취소를
 * 찍고, 만든 예약은 끝에서 반드시 취소한다. `HANJIN_*` 가 비면 SKIP + exit 2.
 *
 * 🔴 개통 전에 LIVE 키로 한 번 돌려 `returnPayType`(기본 CT)이 우리 실계약에서 열려 있는지 본다.
 * 거절(ERROR-14)이 나면 영업담당자에게 R 의 허용 지불조건을 묻는다. DEV 에선 CD 만 거절됐다.
 */
import {
  loadHanjinConfig,
  missingHanjinPickupConfig,
} from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config';
import { HanjinHmacSigner } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer';
import { HanjinApiClient } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client';
import { HanjinCarrierGateway } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway';
import type { PickupRequest } from '../../apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface';

async function main(): Promise<void> {
  const config = loadHanjinConfig(process.env);
  const missing = missingHanjinPickupConfig(config);
  if (missing.length) {
    console.error(`SKIP: HANJIN_* env not configured. Missing/invalid: ${missing.join(', ')}`);
    process.exit(2);
  }
  const client = new HanjinApiClient(
    config,
    new HanjinHmacSigner({ clientId: config.clientId, apiKey: config.apiKey, secretKey: config.secretKey }),
  );
  const gateway = new HanjinCarrierGateway(config, client);
  console.log(`returnPayType=${config.returnPayType} contract=${config.contractNo}`);

  // 한 번 취소한 주문번호는 다시 못 쓴다 — 실행마다 새 번호. ≤30B.
  const custOrdNo = `K8R${Date.now().toString(36).toUpperCase()}`;
  const req: PickupRequest = {
    custOrdNo,
    sender: {
      name: '테스트고객',
      zip: '03154',
      baseAddress: '서울 종로구 세종대로 209',
      detailAddress: '101호',
      mobile: '010-0000-0000',
    },
    recipient: {
      name: config.sender.name,
      zip: config.sender.zip,
      baseAddress: config.sender.baseAddress,
      detailAddress: config.sender.detailAddress,
      tel: config.sender.tel,
    },
    items: [{ name: '스모크상품', quantity: 1 }],
    commodityName: '스모크상품',
    boxType: config.boxType,
    payType: config.returnPayType,
  };

  try {
    console.log('reserve        :', await gateway.reservePickup(req));
    console.log('reserve again  :', await gateway.reservePickup(req));
  } finally {
    // 예약 응답을 잃었어도(타임아웃·전송 오류) 한진엔 예약이 있을 수 있다 — 결과와 무관하게 항상 취소를 묻는다.
    // LIVE 키로 돌리면 남은 예약에 실제 기사가 온다. not_found 는 «예약 없음»이라 그대로 끝
    try {
      const cancelled = await gateway.cancelPickup(custOrdNo);
      console.log('cancel         :', cancelled);
      if (cancelled.kind !== 'not_found') console.log('cancel again   :', await gateway.cancelPickup(custOrdNo));
    } catch (e) {
      console.error(`cancel failed — 한진에 ${custOrdNo} 예약이 남았을 수 있다. 손으로 취소할 것:`, e);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

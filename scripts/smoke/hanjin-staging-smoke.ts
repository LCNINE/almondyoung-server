/**
 * 한진 스테이징 실사격 스모크. CI 아님 — 사람이 직접 실행한다.
 *
 *   npx tsx scripts/smoke/hanjin-staging-smoke.ts
 *
 * `HANJIN_*` env 가 설정되어 있지 않으면 SKIP 메시지를 출력하고 exit 2 로 종료한다(정상 동작).
 * 설정되어 있으면 order 호스트(insert-order/tracking-wbl)를 dev key 로 실사격해 body 매핑을 검증한다.
 * print-wbl(ebbapd, print 호스트)은 방화벽에 발신 IP 가 등록되어 있지 않으면 실패한다 — 그 경우도
 * 크래시 없이 경고 로그만 남기고 계속 진행한다(§3.1-4). 자세한 미해결 리스크는 모듈 README 참조:
 * apps/core/src/modules/fulfillment/waybill/README.md
 */
import {
  loadHanjinConfig,
  isHanjinConfigured,
} from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config';
import { HanjinHmacSigner } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer';
import { HanjinApiClient } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client';
import { HanjinCarrierGateway } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway';
import { assembleWaybillRequest } from '../../apps/core/src/modules/fulfillment/waybill/waybill-request.assembler';

async function main(): Promise<void> {
  const config = loadHanjinConfig(process.env);
  if (!isHanjinConfigured(config)) {
    console.error('SKIP: HANJIN_* env not configured. Set dev keys to run the staging smoke.');
    process.exit(2);
  }

  const signer = new HanjinHmacSigner({
    clientId: config.clientId,
    apiKey: config.apiKey,
    secretKey: config.secretKey,
  });
  const client = new HanjinApiClient(config, signer);
  const gateway = new HanjinCarrierGateway(config, client);

  const req = assembleWaybillRequest({
    shipmentId: '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    recipientSnapshot: {
      recipientName: '테스트수취인',
      phone: '010-0000-0000',
      postalCode: '01234',
      roadAddress: '서울 종로구 세종대로 1',
      detailAddress: '101',
      deliveryNote: '스모크',
    },
    lines: [{ productName: '스모크상품', quantity: 1, skuId: 'smoke' }],
    config,
  });

  // print-wbl: 방화벽 IP 커버 시에만 성공. 커버 안 되면 fetch 가 timeout/거부 → 경고만 남기고 계속.
  console.log('--- allocate(print-wbl) — 방화벽 IP 등록 필요. 실패 시 IP 미커버로 간주 ---');
  let waybillNo: string | undefined;
  try {
    const r = await gateway.allocate(req);
    waybillNo = r.waybillNo;
    console.log('allocate OK:', waybillNo, Object.keys(r.labelData));
  } catch (e) {
    console.warn('allocate FAILED (print-wbl IP 미커버 가능):', (e as Error).message);
  }

  // insert-order/tracking-wbl: order 호스트, dev key 로 검증. waybillNo 없으면(print-wbl 실패) 스킵.
  if (waybillNo) {
    console.log('--- register(insert-order) ---');
    console.log('register:', await gateway.register(waybillNo, req));
    console.log('--- track(tracking-wbl) ---');
    console.log('track:', await gateway.track(waybillNo));
  } else {
    console.warn('SKIP register/track: no waybillNo (print-wbl unavailable).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

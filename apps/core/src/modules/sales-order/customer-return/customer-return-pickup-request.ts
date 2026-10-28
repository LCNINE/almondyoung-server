import type { HanjinConfig } from '../../fulfillment/waybill/carrier/hanjin/hanjin.config';
import type { PickupRequest } from '../../fulfillment/waybill/carrier/carrier-gateway.interface';
import { commodityNameOf, parseRecipient } from '../../fulfillment/waybill/waybill-request.assembler';
import type { PickupSource } from './customer-return-pickup-source.reader';

/**
 * 읽어 온 회수 본문을 캐리어 중립 `PickupRequest` 로 조립한다 (K8 PR9, 순수).
 * 송하인 = 고객(배송완료 상자의 주소 스냅샷), 수하인 = 창고 — 출고와 방향이 반대라 `config.sender` 가 수하인으로 간다.
 * 스냅샷이 불완전하면 `parseRecipient` 가 던지는 BadRequestError(RECIPIENT_INCOMPLETE)를 그대로 올린다.
 * 원운송장이 없으면 키를 비운다 — 게이트웨이가 빈 문자열로 보낸다(한진은 검증하지 않는다).
 */
export function assemblePickupRequest(
  source: Extract<PickupSource, { kind: 'ok' }>,
  config: HanjinConfig,
  custOrdNo: string,
): PickupRequest {
  const customer = parseRecipient(source.snapshot);
  return {
    custOrdNo,
    originalWaybillNo: source.originalWaybillNo ?? undefined,
    sender: {
      name: customer.recipientName,
      zip: customer.postalCode,
      baseAddress: customer.roadAddress,
      detailAddress: customer.detailAddress,
      mobile: customer.phone,
    },
    recipient: {
      name: config.sender.name,
      zip: config.sender.zip,
      baseAddress: config.sender.baseAddress,
      detailAddress: config.sender.detailAddress,
      tel: config.sender.tel,
    },
    items: source.items.map((item) => ({ name: item.name, quantity: item.quantity })),
    commodityName: commodityNameOf(source.items.map((item) => ({ productName: item.name }))),
    boxType: config.boxType,
    payType: config.returnPayType,
  };
}

import { assembleWaybillRequest, parseRecipient } from './waybill-request.assembler';
import type { WaybillRequest } from './carrier/carrier-gateway.interface';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';

const config: HanjinConfig = {
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
    baseAddress: '서울 강남구 테헤란로 1',
    detailAddress: '10층',
    tel: '02-100-2000',
  },
  boxType: 'A',
  payType: 'PP',
};
const snapshot = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '01234',
  roadAddress: '서울 종로구 세종대로 1',
  detailAddress: '101동 202호',
  deliveryNote: '문앞',
};
const shipmentId = '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('parseRecipient', () => {
  it('accepts a complete AddressDto snapshot', () => {
    expect(parseRecipient(snapshot).postalCode).toBe('01234');
  });
  it('throws RECIPIENT_INCOMPLETE when a required field is blank', () => {
    expect(() => parseRecipient({ ...snapshot, postalCode: '  ' })).toThrow(/WAYBILL_RECIPIENT_INCOMPLETE/);
  });
  it('throws when snapshot is null', () => {
    expect(() => parseRecipient(null)).toThrow(/WAYBILL_RECIPIENT_INCOMPLETE/);
  });
});

describe('assembleWaybillRequest', () => {
  const lines = [
    { productName: '아몬드유 30입', quantity: 2, skuId: 's1' },
    { productName: '아몬드유 60입', quantity: 1, skuId: 's2' },
  ];
  const req: WaybillRequest = assembleWaybillRequest({ shipmentId, recipientSnapshot: snapshot, lines, config });

  it('maps recipient split-address fields (postalCode→zip, roadAddress→baseAddress, phone→mobile, deliveryNote→message)', () => {
    expect(req.recipient).toEqual({
      name: '홍길동',
      zip: '01234',
      baseAddress: '서울 종로구 세종대로 1',
      detailAddress: '101동 202호',
      mobile: '010-1234-5678',
      message: '문앞',
    });
  });
  it('takes sender + box/pay from config', () => {
    expect(req.sender).toEqual(config.sender);
    expect(req.boxType).toBe('A');
    expect(req.payType).toBe('PP');
  });
  it('derives custOrdNo from shipmentId', () => {
    expect(req.custOrdNo).toMatch(/^AY[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });
  it('maps lines to items and summarizes commodityName', () => {
    expect(req.items).toEqual([
      { name: '아몬드유 30입', quantity: 2 },
      { name: '아몬드유 60입', quantity: 1 },
    ]);
    expect(req.commodityName).toBe('아몬드유 30입 외 1건');
  });
  it('omits message when deliveryNote absent', () => {
    const r: WaybillRequest = assembleWaybillRequest({
      shipmentId,
      recipientSnapshot: { ...snapshot, deliveryNote: undefined },
      lines,
      config,
    });
    expect(r.recipient.message).toBeUndefined();
  });
});

describe('assembleWaybillRequest — 공동현관 비번 합성', () => {
  // 브리프 원문은 shipmentId: 'ship_1' 이었으나 deriveCustOrdNo 가 유효 uuid hex 를
  // 요구해 항상 throw 한다(합성 로직과 무관하게 RED). 유효 uuid 로 교체.
  const base = {
    shipmentId: '11111111-1111-1111-1111-111111111111',
    recipientSnapshot: {
      recipientName: '홍길동',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '서울시 어딘가',
      detailAddress: '101호',
      deliveryNote: '문 앞에 놓아주세요',
    },
    // ManifestLineLite 는 skuId 를 요구한다(브리프 원문에는 없었음) — type-check 통과를 위해 추가.
    lines: [{ productName: '상품', quantity: 1, skuId: 'sku_1' }],
    config,
  };

  it('비번이 있으면 배송 메시지에 덧붙인다', () => {
    const req = assembleWaybillRequest({ ...base, entrancePassword: '#1234' });
    expect(req.recipient.message).toBe('문 앞에 놓아주세요 (공동현관 #1234)');
  });

  it('비번이 없으면 메모만 싣는다', () => {
    const req = assembleWaybillRequest({ ...base, entrancePassword: null });
    expect(req.recipient.message).toBe('문 앞에 놓아주세요');
  });

  it('메모 없이 비번만 있으면 비번만 싣는다', () => {
    const req = assembleWaybillRequest({
      ...base,
      recipientSnapshot: { ...base.recipientSnapshot, deliveryNote: undefined },
      entrancePassword: '#1234',
    });
    expect(req.recipient.message).toBe('공동현관 #1234');
  });

  it('둘 다 없으면 메시지가 비어 있다', () => {
    const req = assembleWaybillRequest({
      ...base,
      recipientSnapshot: { ...base.recipientSnapshot, deliveryNote: undefined },
      entrancePassword: null,
    });
    expect(req.recipient.message).toBeUndefined();
  });
});

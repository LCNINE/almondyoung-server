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

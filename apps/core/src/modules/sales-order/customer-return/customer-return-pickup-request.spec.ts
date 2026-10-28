import { BadRequestError } from '@app/shared';
import type { HanjinConfig } from '../../fulfillment/waybill/carrier/hanjin/hanjin.config';
import { assemblePickupRequest } from './customer-return-pickup-request';
import type { PickupSource } from './customer-return-pickup-source.reader';

const config = {
  sender: {
    name: '아몬드영 부천',
    zip: '14500',
    baseAddress: '경기 부천시 길주로 1',
    detailAddress: '물류동',
    tel: '032-000-0000',
  },
  boxType: 'A',
  payType: 'PP',
  returnPayType: 'CT',
} as HanjinConfig;

const snapshot = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '03154',
  roadAddress: '서울 종로구 세종대로 209',
  detailAddress: '101호',
};

type Ok = Extract<PickupSource, { kind: 'ok' }>;
const source = (over: Partial<Ok> = {}): Ok => ({
  kind: 'ok',
  snapshot,
  originalWaybillNo: '100000000001',
  items: [{ name: '샴푸', quantity: 2 }],
  ...over,
});

describe('assemblePickupRequest', () => {
  it('송하인은 고객, 수하인은 창고(config.sender)이고 지불조건은 returnPayType 이다', () => {
    const req = assemblePickupRequest(source(), config, 'AR123');
    expect(req.custOrdNo).toBe('AR123');
    expect(req.originalWaybillNo).toBe('100000000001');
    expect(req.sender).toEqual({
      name: '홍길동',
      zip: '03154',
      baseAddress: '서울 종로구 세종대로 209',
      detailAddress: '101호',
      mobile: '010-1234-5678',
    });
    expect(req.recipient).toEqual({
      name: '아몬드영 부천',
      zip: '14500',
      baseAddress: '경기 부천시 길주로 1',
      detailAddress: '물류동',
      tel: '032-000-0000',
    });
    expect(req.payType).toBe('CT');
    expect(req.boxType).toBe('A');
    expect(req.items).toEqual([{ name: '샴푸', quantity: 2 }]);
    expect(req.commodityName).toBe('샴푸');
  });

  it('품목이 둘이면 «첫 품목 외 1건»', () => {
    const req = assemblePickupRequest(
      source({
        items: [
          { name: '샴푸', quantity: 1 },
          { name: '린스', quantity: 1 },
        ],
      }),
      config,
      'AR1',
    );
    expect(req.commodityName).toBe('샴푸 외 1건');
  });

  it('원운송장이 없으면 키를 비운다', () => {
    expect(assemblePickupRequest(source({ originalWaybillNo: null }), config, 'AR1').originalWaybillNo).toBeUndefined();
  });

  it('스냅샷에 우편번호가 없으면 RECIPIENT_INCOMPLETE', () => {
    const { postalCode: _omit, ...broken } = snapshot;
    expect(() => assemblePickupRequest(source({ snapshot: broken }), config, 'AR1')).toThrow(BadRequestError);
    expect(() => assemblePickupRequest(source({ snapshot: broken }), config, 'AR1')).toThrow(/RECIPIENT_INCOMPLETE/);
  });
});

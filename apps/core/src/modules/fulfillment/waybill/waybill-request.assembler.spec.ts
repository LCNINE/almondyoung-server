import {
  assembleWaybillRequest,
  parseRecipient,
  commodityNameOf,
  composeMessage,
  profileSenderOf,
  senderOf,
  senderPreviewOf,
  storedSenderOf,
} from './waybill-request.assembler';
import type { SenderPreviewInput } from './waybill.types';
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
  returnPayType: 'CT',
  labelType: 'NS',
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
  it('accepts a blank detailAddress as an empty string', () => {
    expect(parseRecipient({ ...snapshot, detailAddress: undefined }).detailAddress).toBe('');
  });
  it('throws when snapshot is null', () => {
    expect(() => parseRecipient(null)).toThrow(/WAYBILL_RECIPIENT_INCOMPLETE/);
  });
});

describe('assembleWaybillRequest', () => {
  const lines = [
    { productName: '아몬드유 30입', skuName: '아몬드유 30입', quantity: 2, skuId: 's1' },
    { productName: '아몬드유 60입', skuName: '아몬드유 60입', quantity: 1, skuId: 's2' },
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
    lines: [{ productName: '상품', skuName: '상품', quantity: 1, skuId: 'sku_1' }],
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

describe('commodityNameOf', () => {
  it('한 줄이면 상품명 그대로', () => {
    expect(commodityNameOf([{ productName: '펜', skuName: '펜', quantity: 1, skuId: 'a' }])).toBe('펜');
  });
  it('여러 줄이면 「첫 상품명 외 N건」', () => {
    expect(
      commodityNameOf([
        { productName: '펜', skuName: '펜', quantity: 1, skuId: 'a' },
        { productName: '자', skuName: '자', quantity: 2, skuId: 'b' },
        { productName: '풀', skuName: '풀', quantity: 1, skuId: 'c' },
      ]),
    ).toBe('펜 외 2건');
  });
  it('줄이 없으면 빈 문자열', () => {
    expect(commodityNameOf([])).toBe('');
  });
});

describe('composeMessage', () => {
  it('메모와 공동현관 비번을 합친다', () => {
    expect(composeMessage('문앞', '#1234')).toBe('문앞 (공동현관 #1234)');
  });
  it('둘 다 없으면 undefined', () => {
    expect(composeMessage(undefined, null)).toBeUndefined();
  });
});

describe('배송 프로필 보내는 분', () => {
  const profile = {
    name: '제이시스',
    phone: '010-1111-2222',
    zip: '14521',
    baseAddress: '경기도 부천시 평천로832번길 42',
    detailAddress: '4층',
  };

  it('프로필 보내는 분·출고지를 쓴다', () => {
    expect(senderOf(config, profile)).toEqual({
      name: '제이시스',
      tel: '010-1111-2222',
      zip: '14521',
      baseAddress: '경기도 부천시 평천로832번길 42',
      detailAddress: '4층',
    });
  });

  it('프로필이 없거나 칸이 비면 HANJIN_SENDER_* 로 채운다', () => {
    expect(senderOf(config, null)).toBe(config.sender);
    const partial = senderOf(config, { ...profile, phone: '', zip: '' });
    expect(partial.tel).toBe(config.sender.tel);
    expect(partial.baseAddress).toBe(config.sender.baseAddress);
    expect(partial.detailAddress).toBe(config.sender.detailAddress);
  });

  it('이름 없는 프로필은 보내는 분으로 쓰지 않는다', () => {
    expect(profileSenderOf({ name: '  ', phone: '010' }, null)).toBeNull();
    expect(profileSenderOf(null, null)).toBeNull();
    expect(profileSenderOf({ name: ' 오직미 ', phone: ' 010-1 ' }, { postalCode: '1', roadAddress: 'R' })).toEqual({
      name: '오직미',
      phone: '010-1',
      zip: '1',
      baseAddress: 'R',
      detailAddress: '',
    });
  });

  it('발급 때 저장한 보내는 분이 있으면 지금 프로필보다 먼저 쓴다', () => {
    const lines = [{ productName: 'A', skuName: 'A', quantity: 1, skuId: 's1' }];
    const fresh = assembleWaybillRequest({
      shipmentId,
      recipientSnapshot: snapshot,
      lines,
      config,
      profileSender: profile,
    });
    expect(fresh.sender.name).toBe('제이시스');

    const replay = assembleWaybillRequest({
      shipmentId,
      recipientSnapshot: snapshot,
      lines,
      config,
      profileSender: { ...profile, name: '바뀐 이름' },
      storedSender: fresh.sender,
    });
    expect(replay.sender).toEqual(fresh.sender);
  });

  it('저장값이 없는 옛 송장의 재시도는 등록 때처럼 HANJIN_SENDER_* 를 쓴다', () => {
    const req = assembleWaybillRequest({
      shipmentId,
      recipientSnapshot: snapshot,
      lines: [{ productName: 'A', skuName: 'A', quantity: 1, skuId: 's1' }],
      config,
      profileSender: profile,
      storedSender: null,
    });
    expect(req.sender).toBe(config.sender);
  });

  it('칸이 빠진 저장값(이 칸이 생기기 전 송장)은 쓰지 않는다', () => {
    expect(storedSenderOf(null)).toBeNull();
    expect(storedSenderOf({ name: 'A' })).toBeNull();
  });
});

describe('발급 전 보내는 분 미리보기', () => {
  const profile = { name: '위탁업체', phone: '', zip: '', baseAddress: '', detailAddress: '' };
  const lines = [{ productName: '상품', skuName: '상품', quantity: 1, skuId: 'sku' }];
  const input = (over: Partial<SenderPreviewInput> = {}): SenderPreviewInput => ({
    shipmentId: 'box',
    found: true,
    beforePlan: false,
    profileIncompatible: false,
    profileSender: null,
    ...over,
  });
  // 미리보기 이름이 실제 발급 요청에 실리는 이름과 같아야 한다
  const issuedName = (i: SenderPreviewInput) =>
    assembleWaybillRequest({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      recipientSnapshot: snapshot,
      lines,
      config,
      profileSender: i.profileSender,
      ...(i.storedSender !== undefined ? { storedSender: i.storedSender } : {}),
    }).sender.name;

  it('프로필에 보내는 분이 있으면 그 이름, 출처는 배송 프로필', () => {
    const i = input({ profileSender: profile });
    expect(senderPreviewOf(i, config, true)).toEqual({
      shipmentId: 'box',
      name: '위탁업체',
      source: 'profile',
      beforePlan: false,
    });
    expect(issuedName(i)).toBe('위탁업체');
  });

  it('프로필 값이 없으면 기본 송화인으로 대체된다고 알린다', () => {
    const i = input();
    expect(senderPreviewOf(i, config, true)).toMatchObject({ name: '보내는이', source: 'default' });
    expect(issuedName(i)).toBe('보내는이');
  });

  it('활성 송장이 있으면 프로필이 바뀌었어도 그 행의 이름 — 이어 가기가 그 값을 쓴다', () => {
    const stored = { name: '옛 이름', zip: '1', baseAddress: '주소', detailAddress: '', tel: '' };
    const i = input({ profileSender: profile, storedSender: stored });
    expect(senderPreviewOf(i, config, true)).toMatchObject({ name: '옛 이름', source: 'waybill' });
    expect(issuedName(i)).toBe('옛 이름');
  });

  it('칸이 빠진 옛 송장 행은 기본 송화인으로 등록됐던 것으로 본다', () => {
    const i = input({ profileSender: profile, storedSender: null });
    expect(senderPreviewOf(i, config, true)).toMatchObject({ name: '보내는이', source: 'default' });
    expect(issuedName(i)).toBe('보내는이');
  });

  it('택배사 설정이 비었으면 이름을 내지 않는다', () => {
    expect(senderPreviewOf(input({ profileSender: profile }), config, false)).toMatchObject({
      name: null,
      source: 'unknown',
      reason: 'carrier_not_configured',
    });
  });

  it('확정 전 상자의 SKU 프로필이 갈리면 확인 불가', () => {
    expect(senderPreviewOf(input({ beforePlan: true, profileIncompatible: true }), config, true)).toMatchObject({
      name: null,
      source: 'unknown',
      reason: 'profile_incompatible',
      beforePlan: true,
    });
  });

  it('기본 송화인 이름마저 비면 확인 불가', () => {
    const blank = { ...config, sender: { ...config.sender, name: '  ' } };
    expect(senderPreviewOf(input(), blank, true)).toMatchObject({ name: null, reason: 'sender_missing' });
  });

  it('수기 등록 송장은 우리가 찍은 보내는 분이 없어 확인 불가', () => {
    expect(senderPreviewOf(input({ storedSender: null, manualWaybill: true }), config, true)).toMatchObject({
      name: null,
      source: 'unknown',
      reason: 'manual_waybill',
    });
  });

  it('멈춘 송장은 택배사 설정이 비면 이어 갈 수 없어 확인 불가', () => {
    const stored = { name: '옛 이름', zip: '1', baseAddress: '주소', detailAddress: '', tel: '' };
    expect(senderPreviewOf(input({ storedSender: stored, activeStatus: 'allocated' }), config, false)).toMatchObject({
      name: null,
      reason: 'carrier_not_configured',
    });
    // 이미 등록된 송장은 찍힌 사실이라 그대로 보인다
    expect(senderPreviewOf(input({ storedSender: stored, activeStatus: 'registered' }), config, false)).toMatchObject({
      name: '옛 이름',
      source: 'waybill',
    });
  });

  it('등록된 송장의 프로필이 바뀌었으면 재발급 때 찍힐 이름을 함께 준다 — 재발급 조립과 같다', () => {
    const stored = { name: '옛 이름', zip: '1', baseAddress: '주소', detailAddress: '', tel: '' };
    const i = input({ storedSender: stored, activeStatus: 'registered', profileSender: profile });
    expect(senderPreviewOf(i, config, true)).toMatchObject({
      name: '옛 이름',
      source: 'waybill',
      reissue: { name: '위탁업체', source: 'profile' },
    });
    expect(issuedName({ ...i, storedSender: undefined })).toBe('위탁업체');
    // 같으면 덧붙이지 않는다
    expect(
      senderPreviewOf(input({ ...i, storedSender: { ...stored, name: '위탁업체' } }), config, true).reissue,
    ).toBeUndefined();
  });

  it('없는 상자는 확인 불가', () => {
    expect(senderPreviewOf(input({ found: false }), config, true)).toMatchObject({
      source: 'unknown',
      reason: 'not_found',
    });
  });
});

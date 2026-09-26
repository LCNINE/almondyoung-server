import type { HanjinConfig } from '../hanjin.config';
import type { IssueContext } from '../../../waybill.types';
import { buildHanjinLabelData, type BuildHanjinLabelInput } from './hanjin-label-data';

const CONFIG: HanjinConfig = {
  clientId: 'C',
  apiKey: 'A',
  secretKey: 'S',
  contractNo: 'N',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 1000,
  sender: {
    name: '아몬드영',
    zip: '14521',
    baseAddress: '경기도 부천시 오정구 신흥로511번길 80',
    detailAddress: '1층',
    tel: '032-000-1234',
  },
  boxType: 'A',
  payType: 'CD',
};

const RECIPIENT = {
  recipientName: '김한진',
  phone: '010-1234-5678',
  postalCode: '04533',
  roadAddress: '서울특별시 중구 남대문로 63',
  detailAddress: '한진빌딩 10층',
  deliveryNote: '문앞',
};

const CTX: IssueContext = {
  shipmentId: 's1',
  status: 'planned',
  manifestVersion: 1,
  recipientSnapshot: RECIPIENT,
  lines: [
    { productName: '토익 Speaking', quantity: 1, skuId: 'k1' },
    { productName: '펜', quantity: 2, skuId: 'k2' },
  ],
  entrancePassword: '#1234',
};

const LABEL_DATA = {
  hub_cod: 'NX',
  tml_cod: '150',
  dom_mid: 'Z',
  cen_cod: '1050',
  cen_nam: '해운(집)',
  s_tml_cod: '000',
  s_tml_nam: '본사',
  grp_rnk: 'A1',
  es_nam: '권순천',
  es_cod: '888',
  prt_add: '소공동 51 한진빌딩',
  dom_rgn: '1',
};

const input = (over: Partial<BuildHanjinLabelInput> = {}): BuildHanjinLabelInput => ({
  waybill: { trackingNo: '452716978431', custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS', labelData: LABEL_DATA },
  ctx: CTX,
  config: CONFIG,
  now: new Date('2026-09-27T01:00:00Z'),
  ...over,
});

describe('buildHanjinLabelData', () => {
  it('분류필드를 labelData 에서 옮긴다', () => {
    expect(buildHanjinLabelData(input()).sort).toEqual({
      hubCode: 'NX',
      terminalCode: '150',
      midCode: 'Z',
      centerCode: '1050',
      centerName: '해운(집)',
      originTerminalCode: '000',
      originTerminalName: '본사',
      routeRank: 'A1',
      courierName: '권순천',
      courierSortCode: '888',
      addressSummary: '소공동 51 한진빌딩',
    });
  });

  it('운송장번호를 사람용 4-4-4 로도 만든다', () => {
    const d = buildHanjinLabelData(input());
    expect([d.trackingNo, d.trackingNoDisplay]).toEqual(['452716978431', '4527-1697-8431']);
  });

  it.each([
    ['1', '수도권'],
    ['2', '지방'],
    ['6', '지방'],
    ['7', '제주'],
    ['9', '도서'],
    ['D', 'D'],
  ])('⑮ 권역 %s → %s (모르는 값은 원문)', (code, text) => {
    const d = buildHanjinLabelData(
      input({ waybill: { ...input().waybill, labelData: { ...LABEL_DATA, dom_rgn: code } } }),
    );
    expect(d.regionText).toBe(text);
  });

  it('⑬ CD 는 「발지신용」', () => {
    expect(buildHanjinLabelData(input()).freightText).toBe('발지신용');
  });

  it.each(['PP', 'CC', 'CT'])('⑬ %s 는 운송료 금액이 필요해 지원하지 않는다', (payType) => {
    expect(() => buildHanjinLabelData(input({ config: { ...CONFIG, payType } }))).toThrow(
      new RegExp(`payType ${payType}`),
    );
  });

  it('배송메시지는 발급 때와 같은 합성(메모 + 공동현관)', () => {
    expect(buildHanjinLabelData(input()).deliveryMessage).toBe('문앞 (공동현관 #1234)');
  });

  it('배송메시지가 없으면 빈 문자열', () => {
    const ctx = { ...CTX, recipientSnapshot: { ...RECIPIENT, deliveryNote: '' }, entrancePassword: null };
    expect(buildHanjinLabelData(input({ ctx })).deliveryMessage).toBe('');
  });

  it('품명은 발급 때와 같은 규칙', () => {
    expect(buildHanjinLabelData(input()).commodityName).toBe('토익 Speaking 외 1건');
  });

  it('수하인은 원본으로, 송하인은 설정에서 — 마스킹은 템플릿의 일이다', () => {
    const d = buildHanjinLabelData(input());
    expect(d.recipient).toEqual({
      name: '김한진',
      phone: '010-1234-5678',
      baseAddress: '서울특별시 중구 남대문로 63',
      detailAddress: '한진빌딩 10층',
    });
    expect(d.sender).toEqual({
      name: '아몬드영',
      phone: '032-000-1234',
      baseAddress: '경기도 부천시 오정구 신흥로511번길 80',
    });
  });

  it('출력일자는 런타임 TZ 와 무관하게 KST 날짜다 (UTC 15:30 = KST 다음 날 00:30)', () => {
    expect(buildHanjinLabelData(input({ now: new Date('2026-09-27T15:30:00Z') })).printedDate).toBe('2026-09-28');
  });

  it('박스 1/1, 운임Type·출고번호', () => {
    const d = buildHanjinLabelData(input());
    expect([d.boxIndex, d.boxCount, d.boxType, d.custOrdNo]).toEqual([1, 1, 'A', 'AY0123456789ABCDEFGHJKMNPQRS']);
  });

  it('labelData 의 숫자 값은 문자열로, 없는 키는 빈 문자열로', () => {
    const d = buildHanjinLabelData(input({ waybill: { ...input().waybill, labelData: { hub_cod: 12 } } }));
    expect([d.sort.hubCode, d.sort.terminalCode]).toEqual(['12', '']);
  });

  it('demo 캐리어의 가짜 값으로도 만든다', () => {
    const demo = {
      ...LABEL_DATA,
      hub_cod: 'DEMO',
      tml_cod: 'DEMO',
      dom_rgn: 'D',
      prt_add: '서울 종로구 세종대로 1 101',
    };
    const d = buildHanjinLabelData(
      input({ waybill: { trackingNo: '912345678901', custOrdNo: 'AYX', labelData: demo } }),
    );
    expect([d.sort.hubCode, d.regionText, d.trackingNoDisplay]).toEqual(['DEMO', 'D', '9123-4567-8901']);
  });

  it('운송장번호·출고번호가 없으면 던진다(assertDispatchable 뒤라 불변식 위반)', () => {
    expect(() => buildHanjinLabelData(input({ waybill: { ...input().waybill, custOrdNo: null } }))).toThrow(
      /custOrdNo/,
    );
  });
});

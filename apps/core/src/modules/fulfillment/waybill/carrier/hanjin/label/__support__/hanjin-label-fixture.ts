import type { HanjinLabelData } from '../hanjin-label-data';

/** 한진 라벨 템플릿 테스트 공용 데이터. 받는분·보낸분 원본 값은 누출 테스트가 «없어야 할 문자열»로 쓴다. */
export const HANJIN_LABEL_FIXTURE: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
    hubCode: 'NX',
    terminalCode: '150',
    terminalName: '중구',
    midCode: 'Z',
    centerCode: '1050',
    centerName: '해운(집)',
    originTerminalCode: '000',
    originTerminalName: '본사',
    routeRank: 'A1',
    courierName: '권순천',
    courierSortCode: '888',
    addressSummary: '소공동 51 한진빌딩',
  },
  regionText: '수도권',
  freightText: '발지신용',
  recipient: {
    name: '김한진',
    phone: '010-1234-5678',
    baseAddress: '서울특별시 중구 남대문로 63',
    detailAddress: '한진빌딩 10층',
  },
  sender: { name: '아몬드영', phone: '032-000-1234', baseAddress: '경기도 부천시 오정구 신흥로511번길 80' },
  deliveryMessage: '문앞 (공동현관 #1234)',
  commodityName: '토익 Speaking 외 1건',
  boxType: 'A',
  custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
  printedDate: '2026-09-28',
  boxIndex: 1,
  boxCount: 1,
};

/** 칸 폭·바코드 quiet zone 을 괴롭히는 최악 데이터 — 자유 텍스트를 전부 칸보다 길게. 코드류는 규격 길이 그대로. */
export const HANJIN_LABEL_LONG_FIXTURE: HanjinLabelData = {
  ...HANJIN_LABEL_FIXTURE,
  sort: {
    ...HANJIN_LABEL_FIXTURE.sort,
    terminalName: '가'.repeat(20),
    centerName: '가'.repeat(20),
    originTerminalName: '가'.repeat(20),
    courierName: '가'.repeat(20),
    addressSummary: '가'.repeat(60),
  },
  recipient: { ...HANJIN_LABEL_FIXTURE.recipient, detailAddress: '가'.repeat(80) },
  deliveryMessage: '가'.repeat(100),
  commodityName: '가'.repeat(100),
};

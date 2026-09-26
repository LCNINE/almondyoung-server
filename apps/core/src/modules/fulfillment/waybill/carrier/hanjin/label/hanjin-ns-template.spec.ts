import type { HanjinLabelData } from './hanjin-label-data';
import { renderHanjinNsLabel } from './hanjin-ns-template';

const DATA: HanjinLabelData = {
  trackingNo: '452716978431',
  trackingNoDisplay: '4527-1697-8431',
  sort: {
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

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinNsLabel', () => {
  const spec = renderHanjinNsLabel(DATA);

  it('NS 는 가로 200mm × 세로 102mm, viewBox 도 mm', () => {
    expect([spec.widthMm, spec.heightMm]).toEqual([200, 102]);
    expect(spec.svg).toContain('viewBox="0 0 200 102"');
  });

  describe('개인정보 — 받는고객용(배달표 외)은 전부 가린다', () => {
    const copy = block(spec.svg, 'customer-copy');
    it('받는분 성명·연락처·상세주소 원본이 없다', () => {
      expect(copy).not.toContain('김한진');
      expect(copy).not.toContain('5678');
      expect(copy).not.toContain('한진빌딩 10층');
    });
    it('받는분은 마스킹 형태로 있다', () => {
      expect(copy).toContain('김*진');
      expect(copy).toContain('010-1234-****');
      expect(copy).toContain('서울특별시 중구 남대문로 63 ****');
    });
    it('보낸분도 가린다', () => {
      expect(copy).not.toContain('아몬드영');
      expect(copy).not.toContain('032-000-1234');
      expect(copy).toContain('아*드*'); // 네 글자: 2·4번째
      expect(copy).toContain('032-000-****');
      expect(copy).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  describe('개인정보 — 배달표', () => {
    const slip = block(spec.svg, 'delivery-slip');
    it('받는분 주소는 원본(기본 + 상세)', () => {
      expect(slip).toContain('서울특별시 중구 남대문로 63 한진빌딩 10층');
    });
    it('받는분 성명·연락처는 여기서도 가린다', () => {
      expect(slip).not.toContain('김한진');
      expect(slip).not.toContain('010-1234-5678');
      expect(slip).toContain('김*진');
    });
    it('보낸분 성명·연락처는 원본, 주소는 미표기', () => {
      expect(slip).toContain('아몬드영');
      expect(slip).toContain('032-000-1234');
      expect(slip).not.toContain('신흥로');
    });
  });

  describe('개인정보 — 좌측 블록(양면 공용)에는 어느 개인정보도 없다', () => {
    const left = block(spec.svg, 'left');
    it('받는분 성명·연락처·상세주소·기본주소가 없다', () => {
      expect(left).not.toContain('김한진');
      expect(left).not.toContain('010-1234-5678');
      expect(left).not.toContain('한진빌딩 10층');
      expect(left).not.toContain('서울특별시 중구 남대문로 63');
    });
    it('보낸분 성명·연락처·기본주소가 없다', () => {
      expect(left).not.toContain('아몬드영');
      expect(left).not.toContain('032-000-1234');
      expect(left).not.toContain('신흥로');
    });
  });

  describe('실제 배달표 주소는 동·호수까지 전체가 찍힌다 (#913 최종리뷰 — fitText 단독으로는 잘렸다)', () => {
    const cases: Array<[string, string, string]> = [
      ['경기도 부천시 원미구 길주로 17', '현대아파트 101동 1203호', '101동 1203호'],
      ['부산광역시 해운대구 우동 1411', '센텀아파트 101동 1001호', '101동 1001호'],
      ['경기도 성남시 분당구 판교역로 235', '에이치스퀘어 N동 8층 801호', 'N동 8층 801호'],
    ];
    it.each(cases)('%s %s → 배달표에 "%s" 까지 전체가 찍힌다', (baseAddress, detailAddress, tail) => {
      const s = renderHanjinNsLabel({ ...DATA, recipient: { ...DATA.recipient, baseAddress, detailAddress } });
      const slip = block(s.svg, 'delivery-slip');
      expect(slip).toContain(tail);
    });
  });

  it('긴 ⑭ 도 배달표에서는 공동현관 비밀번호까지 전체가 찍힌다(먼저 크기를 줄이고, 그래도 넘치면 자른다)', () => {
    const longMessage = '부재 시 경비실에 맡겨 주세요. 파손 주의 부탁드립니다 (공동현관 #1234)';
    const s = renderHanjinNsLabel({ ...DATA, deliveryMessage: longMessage });
    const slip = block(s.svg, 'delivery-slip');
    expect(slip).toContain('공동현관 #1234');
  });

  it('라벨 어디에도 받는분 실명·전체 전화번호가 없다', () => {
    expect(spec.svg).not.toContain('김한진');
    expect(spec.svg).not.toContain('010-1234-5678');
  });

  it('분류코드·운임·권역·출고번호를 찍는다', () => {
    for (const s of [
      'NX',
      '150',
      'Z',
      '888',
      'A1',
      '권순천',
      '1050',
      '해운(집)',
      '발지신용',
      '수도권',
      '소공동 51 한진빌딩',
      '2026년 09월 28일',
      '운임Type:A',
      'AY0123456789ABCDEFGHJKMNPQRS',
      '4527-1697-8431',
      '1/1',
    ]) {
      expect(spec.svg).toContain(s);
    }
  });

  it('바코드는 ITF(운송장번호)와 CODE128(터미널코드) 둘', () => {
    expect(spec.barcodes.map((b) => [b.kind, b.data])).toEqual([
      ['CODE128', '150'],
      ['ITF', '452716978431'],
    ]);
  });

  it('터미널코드가 비면 CODE128 을 빼고 ITF 만 둔다', () => {
    const s = renderHanjinNsLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프한다', () => {
    const s = renderHanjinNsLabel({ ...DATA, deliveryMessage: '<script>&', commodityName: 'A&B "펜"' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it('긴 배송메시지·품명·주소는 말줄임으로 자른다', () => {
    const long = '가'.repeat(200);
    const s = renderHanjinNsLabel({
      ...DATA,
      deliveryMessage: long,
      commodityName: long,
      recipient: { ...DATA.recipient, detailAddress: long },
    });
    expect(s.svg).not.toContain(long);
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('출고번호는 자르지 않고 글자를 줄인다', () => {
    expect(spec.svg).toContain('출고번호: AY0123456789ABCDEFGHJKMNPQRS');
  });

  it('배송메시지에 섞인 XML 금지 제어문자는 SVG 에 남기지 않는다 (resvg 파싱 실패 방지)', () => {
    const s = renderHanjinNsLabel({ ...DATA, deliveryMessage: '문앞\u000B' });
    expect(s.svg).not.toContain('\u000B');
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    expect(Math.max(...ys)).toBeLessThanOrEqual(102);
    for (const b of spec.barcodes) expect(b.yMm + b.heightMm).toBeLessThanOrEqual(102);
  });

  it('demo 캐리어 값으로도 그린다', () => {
    const demo = renderHanjinNsLabel({
      ...DATA,
      regionText: 'D',
      sort: { ...DATA.sort, hubCode: 'DEMO', terminalCode: 'DEMO' },
    });
    expect(demo.svg).toContain('DEMO');
  });
});

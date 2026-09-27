import { barcodeKeepOutsMm, inkInBarcodeKeepOuts } from '../../../label/__support__/label-invariants';
import { HANJIN_LABEL_FIXTURE as DATA, HANJIN_LABEL_LONG_FIXTURE as LONG } from './__support__/hanjin-label-fixture';
import {
  NL_CUST_ORD_NO_MAX_WIDTH_MM,
  NL_CUST_ORD_NO_X_MM,
  NL_ITF_QUIET_ZONE_MM,
  NL_ITF_X_MM,
  renderHanjinNlLabel,
} from './hanjin-nl-template';

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinNlLabel', () => {
  const spec = renderHanjinNlLabel(DATA);

  it('NL 은 가로 100 × 세로 102mm 이고 돌리지 않는다(폭 100mm 가 인쇄폭 108mm 안)', () => {
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([100, 102, 0]);
    expect(spec.svg).toContain('viewBox="0 0 100 102"');
  });

  it('면 블록은 분류 머리 · 배달표 · 받는고객용 순서', () => {
    expect([...spec.svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1])).toEqual([
      'sort-head',
      'delivery-slip',
      'customer-copy',
    ]);
  });

  describe('개인정보 — 배달표', () => {
    const slip = block(spec.svg, 'delivery-slip');
    it('받는분 주소는 원본(기본 + 상세)', () => {
      expect(slip).toContain('서울특별시 중구 남대문로 63 한진빌딩 10층');
    });
    it('받는분 성명·연락처는 가린다', () => {
      expect(slip).not.toContain('김한진');
      expect(slip).not.toContain('010-1234-5678');
      expect(slip).toContain('김*진');
      expect(slip).toContain('010-1234-****');
    });
    it('보낸분 성명·연락처는 원본, 주소는 마스킹(샘플대로 — NS 는 미표기)', () => {
      expect(slip).toContain('아몬드영');
      expect(slip).toContain('032-000-1234');
      expect(slip).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  describe('개인정보 — 받는고객용(배달표 외)', () => {
    const copy = block(spec.svg, 'customer-copy');
    it('받는분은 ⑫ 약칭주소만 — 성명·연락처·실제 주소가 없다', () => {
      expect(copy).toContain('소공동 51 한진빌딩');
      for (const s of ['김한진', '김*진', '010-1234', '남대문로', '한진빌딩 10층']) expect(copy).not.toContain(s);
    });
    it('보낸분은 전부 가린다', () => {
      expect(copy).not.toContain('아몬드영');
      expect(copy).not.toContain('032-000-1234');
      expect(copy).toContain('아*드*');
      expect(copy).toContain('032-000-****');
      expect(copy).toContain('경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  it('보낸분 원본주소의 참고항목(동)은 마스킹 뒤에도 새지 않는다(#913 최종리뷰 F6)', () => {
    const s = renderHanjinNlLabel({
      ...DATA,
      sender: { ...DATA.sender, baseAddress: '경기도 부천시 오정구 신흥로511번길 80 (오정동)' },
    });
    expect(s.svg).not.toContain('(오정동)');
    expect(s.svg).toContain('신흥로511번길 80 ****');
  });

  it('분류 머리에는 어느 개인정보도 없다', () => {
    const head = block(spec.svg, 'sort-head');
    for (const s of ['김한진', '김*진', '010-1234', '남대문로', '아몬드영', '032-000', '신흥로']) {
      expect(head).not.toContain(s);
    }
  });

  it('라벨 어디에도 받는분 실명·전체 전화번호가 없다', () => {
    expect(spec.svg).not.toContain('김한진');
    expect(spec.svg).not.toContain('010-1234-5678');
  });

  describe('배달표 받는분 주소는 동·호수까지 전체가 찍힌다', () => {
    const cases: Array<[string, string, string]> = [
      ['경기도 부천시 원미구 길주로 17', '현대아파트 101동 1203호', '101동 1203호'],
      ['부산광역시 해운대구 우동 1411', '센텀아파트 101동 1001호', '101동 1001호'],
      ['경기도 성남시 분당구 판교역로 235', '에이치스퀘어 N동 8층 801호', 'N동 8층 801호'],
    ];
    it.each(cases)('%s %s → "%s"', (baseAddress, detailAddress, tail) => {
      const s = renderHanjinNlLabel({ ...DATA, recipient: { ...DATA.recipient, baseAddress, detailAddress } });
      expect(block(s.svg, 'delivery-slip')).toContain(tail);
    });
  });

  it('긴 ⑭ 도 공동현관 비밀번호까지 찍힌다', () => {
    const s = renderHanjinNlLabel({
      ...DATA,
      deliveryMessage: '부재 시 경비실에 맡겨 주세요. 파손 주의 부탁드립니다 (공동현관 #1234)',
    });
    expect(block(s.svg, 'delivery-slip')).toContain('공동현관 #1234');
  });

  it('분류코드·터미널명·운임·권역·출고번호를 찍는다', () => {
    for (const s of [
      'NX',
      '150',
      '중구',
      'Z',
      '888',
      'A1',
      '권순천',
      '1050',
      '해운(집)',
      '발지TML 000 본사',
      '발지신용',
      '수도권',
      '소공동 51 한진빌딩',
      '출력일자 :',
      '2026년 09월 28일',
      '수량: 1',
      '운임Type:A',
      '출고번호: AY0123456789ABCDEFGHJKMNPQRS',
      '4527-1697-8431',
      'P. 1',
      '토익 Speaking 외 1건',
    ]) {
      expect(spec.svg).toContain(s);
    }
  });

  it('바코드는 CODE128(터미널코드)과 ITF(운송장번호) 둘', () => {
    expect(spec.barcodes.map((b) => [b.kind, b.data])).toEqual([
      ['CODE128', '150'],
      ['ITF', '452716978431'],
    ]);
  });

  it('터미널코드가 비면(demo 캐리어) CODE128 을 빼고 ITF 만 둔다', () => {
    const s = renderHanjinNlLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프하고 금지 제어문자는 뺀다', () => {
    const s = renderHanjinNlLabel({ ...DATA, deliveryMessage: '<script>&\u000B', commodityName: 'A&B "펜"' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).not.toContain('\u000B');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it('출고번호 칸은 ITF quiet zone 앞에서 끝난다', () => {
    expect(NL_CUST_ORD_NO_X_MM + NL_CUST_ORD_NO_MAX_WIDTH_MM).toBeCloseTo(NL_ITF_X_MM - NL_ITF_QUIET_ZONE_MM, 9);
  });

  it.each([
    ['기본', DATA],
    ['긴 데이터', LONG],
    ['박스 10/12', { ...DATA, boxIndex: 10, boxCount: 12 }],
  ])('%s: 바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', (_, data) => {
    const s = renderHanjinNlLabel(data);
    for (const z of barcodeKeepOutsMm(s)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(s.widthMm);
      expect(z.y1).toBeLessThanOrEqual(s.heightMm);
    }
    expect(inkInBarcodeKeepOuts(s)).toEqual(s.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });

  it('긴 자유 텍스트는 말줄임으로 자른다', () => {
    const s = renderHanjinNlLabel(LONG);
    expect(s.svg).not.toContain('가'.repeat(100));
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(Math.max(...ys)).toBeLessThanOrEqual(102);
  });
});

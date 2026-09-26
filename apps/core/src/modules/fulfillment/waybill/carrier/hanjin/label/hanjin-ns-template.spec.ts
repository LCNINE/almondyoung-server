import { createHash } from 'crypto';
import { deriveCustOrdNo } from '../../../cust-ord-no';
import { DOTS_PER_MM, getBit } from '../../../label/label-model';
import { SvgRasterizer } from '../../../label/svg-rasterizer';
import { PT_TO_MM, textWidthMm } from '../../../label/svg-text';
import type { HanjinLabelData } from './hanjin-label-data';
import {
  CUST_ORD_NO_MAX_WIDTH_MM,
  CUST_ORD_NO_MIN_PT,
  CUST_ORD_NO_X_MM,
  custOrdNoPt,
  ITF_QUIET_ZONE_MM,
  ITF_X_MM,
  renderHanjinNsLabel,
} from './hanjin-ns-template';

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

/** 결정적 UUID v4 모양 — 카운터를 sha256 으로 흩어 버전·variant 비트만 v4 로 맞춘다. */
const uuidV4Of = (i: number): string => {
  const h = createHash('sha256').update(`shipment-${i}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const rasterizer = new SvgRasterizer();

/** svg(또는 그 일부) 안에서 `pick` 에 맞는 <text> 요소 하나. */
const textElement = (svg: string, pick: (el: string) => boolean): string => {
  const el = [...svg.matchAll(/<text [^>]*>[^<]*<\/text>/g)].map((m) => m[0]).find(pick);
  if (!el) throw new Error('text element not found');
  return el;
};

/**
 * 라벨 svg 의 <text> 요소 하나만 떼어, 같은 좌표·크기로 프린터 해상도(8 dot/mm)에서 그렸을 때
 * 잉크 오른쪽 끝의 x(mm). 인쇄되는 비트맵과 같은 경로(SvgRasterizer)를 탄다.
 */
const inkRightEdgeMm = (svg: string, el: string): number => {
  const header = /^<svg [^>]*>/.exec(svg)?.[0];
  if (!header) throw new Error('svg header not found');
  const b = rasterizer.rasterize(`${header}${el}</svg>`, 200 * DOTS_PER_MM);
  let right = -1;
  for (let y = 0; y < b.heightDots; y++) for (let x = right + 1; x < b.widthDots; x++) if (getBit(b, x, y)) right = x;
  if (right < 0) throw new Error(`nothing rendered for ${el}`);
  return (right + 1) / DOTS_PER_MM;
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

  describe('출고번호는 ITF quiet zone(3.75mm) 앞에서 끝난다 (#913 — 잉크가 ITF 안까지 들어갔다)', () => {
    const QUIET_ZONE_START = ITF_X_MM - ITF_QUIET_ZONE_MM; // R+46.25

    it('ITF 는 같은 상수 위치에 놓이고, quiet zone 은 10 × 3dot 모듈 = 3.75mm 다', () => {
      const itf = spec.barcodes.find((b) => b.kind === 'ITF');
      expect(itf?.xMm).toBe(ITF_X_MM);
      expect(ITF_QUIET_ZONE_MM).toBe((10 * (itf?.moduleDots ?? 0)) / DOTS_PER_MM);
      expect(CUST_ORD_NO_X_MM + CUST_ORD_NO_MAX_WIDTH_MM).toBeCloseTo(QUIET_ZONE_START, 9);
    });

    // UUID 에서 파생한 실제 모양의 출고번호 500개 — 모델 폭으로 칸 안에 들어가는지 전수 확인.
    const samples = Array.from({ length: 500 }, (_, i) => `출고번호: ${deriveCustOrdNo(uuidV4Of(i))}`);
    const endMm = (t: string) => CUST_ORD_NO_X_MM + textWidthMm(t, custOrdNoPt(t));

    it('UUID 파생 출고번호 500개 모두 최소 4pt 이상으로 quiet zone 앞에서 끝난다(모델 폭)', () => {
      for (const t of samples) {
        expect(custOrdNoPt(t)).toBeGreaterThanOrEqual(CUST_ORD_NO_MIN_PT);
        expect(endMm(t)).toBeLessThanOrEqual(QUIET_ZONE_START + 1e-9);
      }
    });

    it('그중 가장 긴 표본과 픽스처 표본은 실제로 그려도 잉크가 quiet zone 앞에서 끝난다', () => {
      const worst = samples.reduce((a, b) => (endMm(b) > endMm(a) ? b : a));
      for (const custOrdNo of [worst.slice('출고번호: '.length), DATA.custOrdNo]) {
        const text = `출고번호: ${custOrdNo}`;
        const label = renderHanjinNsLabel({ ...DATA, custOrdNo });
        const el = new RegExp(`<text [^>]*font-size="([\\d.]+)"[^>]*>${text}</text>`).exec(label.svg);
        expect(el?.[1]).toBe((custOrdNoPt(text) * PT_TO_MM).toFixed(2)); // 라벨이 실제로 그 크기로 그린다
        const custEl = textElement(label.svg, (t) => t.includes(`>${text}<`));
        expect(inkRightEdgeMm(label.svg, custEl)).toBeLessThanOrEqual(QUIET_ZONE_START);
      }
    });
  });

  describe('공백 없는 긴 한글도 이웃 칸을 넘지 않는다(실제 렌더) — 폭 모델이 과소추정하면 넘친다', () => {
    const noSpaces = '가나다라마바사아자차카타파하'.repeat(10);
    const s = renderHanjinNsLabel({ ...DATA, deliveryMessage: noSpaces, commodityName: noSpaces });
    /** 그룹 안에서 x 좌표가 `x` 인, 말줄임으로 잘린 <text> 요소. */
    const fittedAt = (group: string, x: string): string =>
      textElement(block(s.svg, group), (t) => t.startsWith(`<text x="${x}" `) && t.includes('…'));

    it('좌측 ⑭(x=2) 는 ⑮ 상자(x=70, 선 두께 0.4) 앞에서 끝난다', () => {
      expect(inkRightEdgeMm(s.svg, fittedAt('left', '2'))).toBeLessThanOrEqual(69.5);
    });
    it('품명(x=1.5) 은 구분선 끝(x=96) 앞에서 끝난다', () => {
      expect(inkRightEdgeMm(s.svg, fittedAt('left', '1.5'))).toBeLessThanOrEqual(96);
    });
    it('배달표 ⑭(x=R+6) 는 라벨 오른쪽 끝(x=200) 앞에서 끝난다', () => {
      expect(inkRightEdgeMm(s.svg, fittedAt('delivery-slip', '106'))).toBeLessThanOrEqual(199);
    });
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

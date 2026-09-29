import { barcodeKeepOutsMm, inkInBarcodeKeepOuts } from '../../../label/__support__/label-invariants';
import type { LabelSpec } from '../../../label/label-model';
import { PT_TO_MM, textWidthMm } from '../../../label/svg-text';
import { HANJIN_LABEL_FIXTURE as DATA, HANJIN_LABEL_LONG_FIXTURE as LONG } from './__support__/hanjin-label-fixture';
import { renderHanjinFsLabel } from './hanjin-fs-template';
import type { HanjinLabelData } from './hanjin-label-data';

/** 첫 쪽 — 기존 단일 쪽 테스트는 전부 첫 쪽의 성질이다. */
const fs1 = (d: HanjinLabelData): LabelSpec => {
  const [first] = renderHanjinFsLabel(d);
  return first;
};

const block = (svg: string, id: string): string => {
  const m = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(svg);
  if (!m) throw new Error(`block ${id} not found`);
  return m[1];
};

describe('renderHanjinFsLabel', () => {
  const spec = fs1(DATA);

  // 270° 는 창고 실물 출력으로 정했다(2026-09-28, XP-DT108B + FS 라벨지): 90° 는 선인쇄와 위아래가 뒤집혀 나왔다.
  it('FS 는 가로 123 × 세로 100mm, 270° 돌려 짧은 변(100mm)을 폭으로 넣는다', () => {
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([123, 100, 270]);
    expect(spec.svg).toContain('viewBox="0 0 123 100"');
  });

  it('라벨 전체가 배달표 한 면이다', () => {
    expect([...spec.svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1])).toEqual(['delivery-slip']);
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
    it('보낸분 성명·연락처는 원본, 주소는 마스킹', () => {
      expect(slip).toContain('아몬드영 / 032-000-1234 / 경기도 부천시 오정구 신흥로511번길 80 ****');
    });
  });

  // 2026-09-29 한진 DEV 제주 샘플에서 허브 `MG` 가 35pt 고정으로 찍혀 터미널코드 `610` 과 겹쳤다.
  // 허브 코드는 영문 2자라 글자에 따라 폭이 크게 다르다(`2A` < `SS` < `MG` < `WW`).
  describe('허브 코드(①)는 터미널코드(② x=24.5) 앞에서 멈춘다', () => {
    const hubWidthMm = (hubCode: string): { pt: number; widthMm: number } => {
      const s = fs1({ ...DATA, sort: { ...DATA.sort, hubCode } });
      const m = /<text x="5" y="19.4" font-size="([\d.]+)" font-weight="700">([^<]*)<\/text>/.exec(s.svg);
      if (!m) throw new Error('hub code text element not found');
      expect(m[2]).toBe(hubCode);
      const pt = Number(m[1]) / PT_TO_MM;
      return { pt, widthMm: textWidthMm(hubCode, pt) };
    };

    it.each(['MG', 'MW', 'WW'])('%s 는 글자를 줄여 칸 안에 넣는다', (hubCode) => {
      const { pt, widthMm } = hubWidthMm(hubCode);
      expect(pt).toBeLessThan(35);
      expect(5 + widthMm).toBeLessThanOrEqual(24.5 - 0.5);
    });

    it.each(['SS', '2A', 'NX'])('%s 처럼 칸에 들어가는 코드는 원래 크기(35pt) 그대로다', (hubCode) => {
      // font-size 는 소수 둘째 자리까지 찍혀 pt 로 되돌리면 35 가 정확히 안 나온다. 줄일 때는 0.5pt 단위다.
      expect(Math.abs(hubWidthMm(hubCode).pt - 35)).toBeLessThan(0.25);
    });
  });

  // 필드표(fs2)는 ⑫ 를 「19」로 적지만 단위가 없고, 샘플 그림(fs_new)에서 폭을 재 역산하면 ⑫ 만 표의 60%
  // (≈11.3pt)로 그려져 있다 — 다른 요소는 0.9~0.97 로 표와 맞는다(2026-09-29). 그림을 따른다.
  it('⑫ 주소 출력정보는 12pt bold 로 찍는다(샘플 그림 크기)', () => {
    expect(spec.svg).toContain(
      `<text x="7.8" y="39.4" font-size="${(12 * PT_TO_MM).toFixed(2)}" font-weight="700">소공동 51 한진빌딩</text>`,
    );
  });

  it('받는분 성명이 길면 고정 x=35.1 의 연락처를 침범하기 전에 말줄임한다(#913 최종리뷰 F5)', () => {
    const s = fs1({
      ...DATA,
      recipient: { ...DATA.recipient, name: '아몬드영뷰티 강남점 김한진' },
    });
    const el = /<text x="7.8" y="27.7"[^>]*>([^<]*)<\/text>/.exec(s.svg);
    if (!el) throw new Error('recipient name text element not found');
    expect(textWidthMm(el[1], 10)).toBeLessThanOrEqual(26.3);
    expect(el[1].endsWith('…')).toBe(true);
    // 기본 픽스처 출력은 그대로다.
    expect(spec.svg).toContain('김*진');
  });

  it('보낸분 원본주소의 참고항목(동)은 마스킹 뒤에도 새지 않는다(#913 최종리뷰 F6)', () => {
    const s = fs1({
      ...DATA,
      sender: { ...DATA.sender, baseAddress: '경기도 부천시 오정구 신흥로511번길 80 (오정동)' },
    });
    expect(s.svg).not.toContain('(오정동)');
    expect(s.svg).toContain('신흥로511번길 80 ****');
  });

  describe('배달표 받는분 주소는 동·호수까지 전체가 찍힌다', () => {
    const cases: Array<[string, string, string]> = [
      ['경기도 부천시 원미구 길주로 17', '현대아파트 101동 1203호', '101동 1203호'],
      ['부산광역시 해운대구 우동 1411', '센텀아파트 101동 1001호', '101동 1001호'],
      ['경기도 성남시 분당구 판교역로 235', '에이치스퀘어 N동 8층 801호', 'N동 8층 801호'],
    ];
    it.each(cases)('%s %s → "%s"', (baseAddress, detailAddress, tail) => {
      const s = fs1({ ...DATA, recipient: { ...DATA.recipient, baseAddress, detailAddress } });
      expect(s.svg).toContain(tail);
    });
  });

  it('긴 ⑭ 는 두 줄로 나눠 공동현관 비밀번호까지 잃지 않는다', () => {
    const msg = '부재 시 경비실에 맡겨 주세요. 파손 주의 (공동현관 #1234)';
    const s = fs1({ ...DATA, deliveryMessage: msg });
    const lines = [...s.svg.matchAll(/<text x="8.8" [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(msg);
  });

  it('짧은 ⑭ 는 샘플 자리(기준선 93.7) 한 줄', () => {
    expect(spec.svg).toContain('<text x="8.8" y="93.7" font-size="3.18">문앞 (공동현관 #1234)</text>');
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
      '발지:000 본사',
      '발지신용',
      '수도권',
      '소공동 51 한진빌딩',
      '2026-09-28 Type : A',
      '운임Type : A',
      '출고번호: AY0123456789ABCDEFGHJKMNPQRS',
      '4527-1697-8431',
      '토익 Speaking',
      '펜',
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
    const s = fs1({ ...DATA, sort: { ...DATA.sort, terminalCode: '' } });
    expect(s.barcodes.map((b) => b.kind)).toEqual(['ITF']);
  });

  it('고객 입력의 XML 특수문자를 이스케이프하고 금지 제어문자는 뺀다', () => {
    const s = fs1({
      ...DATA,
      deliveryMessage: '<script>&\u000B',
      items: [{ locationCode: 'A-1', skuId: 's1', name: 'A&B "펜"', quantity: 1 }],
    });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).not.toContain('\u000B');
    expect(s.svg).toContain('&lt;script&gt;&amp;');
    expect(s.svg).toContain('A&amp;B &quot;펜&quot;');
  });

  it.each([
    ['기본', DATA],
    ['긴 데이터', LONG],
  ])('%s: 바코드 금지 구역(바코드 + 좌우 quiet zone)은 라벨 안이고 잉크가 없다', (_, data) => {
    const s = fs1(data);
    for (const z of barcodeKeepOutsMm(s)) {
      expect(z.x0).toBeGreaterThanOrEqual(0);
      expect(z.x1).toBeLessThanOrEqual(s.widthMm);
      expect(z.y1).toBeLessThanOrEqual(s.heightMm);
    }
    expect(inkInBarcodeKeepOuts(s)).toEqual(s.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
  });

  it('긴 자유 텍스트는 말줄임으로 자른다', () => {
    const s = fs1(LONG);
    expect(s.svg).not.toContain('가'.repeat(100));
    expect((s.svg.match(/…/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('모든 텍스트·도형 좌표가 라벨 안에 있다', () => {
    const xs = [...spec.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const ys = [...spec.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(123);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});

describe('renderHanjinFsLabel — 품목 줄·추가 쪽', () => {
  const ITEMS = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      locationCode: `A-${i + 1}`,
      skuId: `s${i + 1}`,
      name: `품목${i + 1}`,
      quantity: i + 1,
    }));
  const pagesOf = (n: number) => renderHanjinFsLabel({ ...DATA, items: ITEMS(n) });
  const namesOn = (page: LabelSpec) =>
    [...page.svg.matchAll(/<text x="4.5" y="(?:57|62.2|67.4|72.6)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])('품목 %d 줄 → %d 쪽', (n, pages) => {
    expect(pagesOf(n)).toHaveLength(pages);
  });

  it('모든 쪽 같은 자리에 4줄씩, 순서대로', () => {
    expect(pagesOf(9).map(namesOn)).toEqual([
      ['품목1', '품목2', '품목3', '품목4'],
      ['품목5', '품목6', '품목7', '품목8'],
      ['품목9'],
    ]);
  });

  it('수량은 오른쪽 끝(x 119)에 끝 정렬로 찍는다', () => {
    const [first] = pagesOf(1);
    expect(first.svg).toMatch(/<text x="119" y="57" [^>]*text-anchor="end">1<\/text>/);
  });

  it('쪽 표시: n/N · 총 건수·수량 합 — 정확히 4줄이면 1/1', () => {
    expect(pagesOf(9).map((p) => /(\d+\/\d+ · 총 \d+건 \d+개)/.exec(p.svg)?.[1])).toEqual([
      '1/3 · 총 9건 45개',
      '2/3 · 총 9건 45개',
      '3/3 · 총 9건 45개',
    ]);
    const four = pagesOf(4);
    expect(four).toHaveLength(1);
    expect(four[0].svg).toContain('1/1 · 총 4건 10개');
  });

  it('바코드는 첫 쪽에만 — 추가 쪽은 0개', () => {
    expect(pagesOf(5).map((p) => p.barcodes.length)).toEqual([2, 0]);
  });

  it('demo 캐리어(터미널코드 빈 값) 여러 쪽: 첫 쪽 ITF 하나, 추가 쪽 0', () => {
    const pages = renderHanjinFsLabel({ ...DATA, sort: { ...DATA.sort, terminalCode: '' }, items: ITEMS(5) });
    expect(pages.map((p) => p.barcodes.map((b) => b.kind))).toEqual([['ITF'], []]);
  });

  it('추가 쪽은 「발송 금지」 두 곳 + 짝 맞추기 정보만, 첫 쪽 전용 요소는 없다', () => {
    const [first, second] = pagesOf(5);
    expect(first.svg).not.toContain('발송 금지');
    expect(second.svg).toContain('<g id="continuation">');
    expect(second.svg).toContain('발송 금지 · 상품 확인용');
    expect(second.svg).toMatch(/>발송 금지<\/text>/);
    for (const kept of ['4527-1697-8431', '김*진', '010-1234-****', '출고번호: AY0123456789ABCDEFGHJKMNPQRS']) {
      expect(second.svg).toContain(kept);
    }
    for (const gone of [
      '남대문로 63',
      '소공동 51 한진빌딩',
      '>NX</text>',
      '발지신용',
      '수도권',
      '운임Type',
      '문앞',
      '<rect',
    ]) {
      expect(second.svg).not.toContain(gone);
    }
  });

  it('큰 수량이어도 이름이 수량 칸을 덮지 않는다', () => {
    const [page] = renderHanjinFsLabel({
      ...DATA,
      items: [{ locationCode: 'A-1', skuId: 's1', name: '가'.repeat(60), quantity: 1000 }],
    });
    const m = /<text x="4.5" y="57" font-size="([\d.]+)">([^<]*)<\/text>/.exec(page.svg);
    if (!m) throw new Error('item name element not found');
    const nameWidthMm = textWidthMm(m[2], Number(m[1]) / PT_TO_MM);
    expect(4.5 + nameWidthMm).toBeLessThanOrEqual(119 - textWidthMm('1000', 11) - 3 + 0.05);
    expect(m[2].endsWith('…')).toBe(true);
  });

  it('SKU명의 XML 특수문자는 이스케이프하고 금지 제어문자는 뺀다', () => {
    const [page] = renderHanjinFsLabel({
      ...DATA,
      items: [{ locationCode: 'A-1', skuId: 's1', name: '<b>&"펜"\u000B', quantity: 1 }],
    });
    expect(page.svg).not.toContain('<b>');
    expect(page.svg).not.toContain('\u000B');
    expect(page.svg).toContain('&lt;b&gt;&amp;&quot;펜&quot;');
  });

  it.each([
    ['기본 9줄', { ...DATA, items: ITEMS(9) }],
    [
      '긴 데이터 5줄',
      {
        ...LONG,
        items: Array.from({ length: 5 }, () => ({
          locationCode: 'Z'.repeat(64),
          skuId: 'sku-long',
          name: '가'.repeat(100),
          quantity: 9999,
        })),
      },
    ],
  ])('%s: 모든 쪽의 바코드 금지 구역에 잉크가 없고 좌표가 라벨 안이다', (_, data) => {
    for (const page of renderHanjinFsLabel(data)) {
      expect(inkInBarcodeKeepOuts(page)).toEqual(page.barcodes.map((b) => ({ kind: b.kind, ink: 0 })));
      const xs = [...page.svg.matchAll(/\bx="([\d.]+)"/g)].map((m) => Number(m[1]));
      const ys = [...page.svg.matchAll(/\by="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs)).toBeLessThanOrEqual(123);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    }
  });
});

import {
  createSaleComponent,
  defaultSaleDisplay,
  defaultTimeSaleSettings,
  type SaleComponent,
  type SalePreviewState,
} from '../../../../../../../packages/domain-types/time-sale';
import {
  BADGE_SHAPES,
  SaleRenderer,
  activePageOf,
  pageStarts,
  timerParts,
  previewAnchorFor,
  previewRemainingSeconds,
  productStyle,
  resolveProductState,
  resolveSectionPeriod,
  resolveUserVariables,
  blockPreviewNavigation,
  type SaleProduct,
} from '../../../../../../../packages/time-sale-ui';

const { createElement } =
  require('../../../../../../../node_modules/react') as typeof import('react');

const { renderToStaticMarkup } =
  require('../../../../../../../node_modules/react-dom/server') as typeof import('react-dom/server');

const product: SaleProduct = {
  id: 'p1',
  name: '상품A',
  href: '/p/1',
  price: 5000,
  originalPrice: 10000,
  soldOut: false,
};

const defaultDisplay = () => defaultSaleDisplay();

const render = (
  c: SaleComponent,
  state: SalePreviewState,
  products = [product]
) => {
  const settings = defaultTimeSaleSettings();
  settings.styles.main.pc.components = [c];

  return renderToStaticMarkup(
    createElement(SaleRenderer, {
      settings,
      surface: 'main',
      platform: 'pc',
      saleId: 's1',
      title: '세일',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-01-02T00:00:00Z',
      products,
      previewState: state,
      sanitizeHtml: (html: string) => html,
    })
  );
};

describe('SaleRenderer', () => {
  it('상태별·품절 상품 CSS 가 순서대로 덮인다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.productCss = { opacity: 1, color: 'black' };
    c.options.endedCss = { opacity: 0.5 };
    c.options.soldOutCss = { color: 'gray', opacity: 0.2 };

    expect(productStyle(c, 'ended', true)).toEqual({
      opacity: 0.2,
      color: 'gray',
    });
    expect(productStyle(c, 'ended', false)).toEqual({
      opacity: 0.5,
      color: 'black',
    });
    expect(productStyle(c, 'active', false)).toEqual({
      opacity: 1,
      color: 'black',
    });
  });

  it('마감 CSS 를 비우면 회색조 기본값이 적용된다', () => {
    const c = createSaleComponent('grid', 'g');

    expect(productStyle(c, 'ended', false)).toEqual({
      filter: 'grayscale(100%)',
      opacity: 0.5,
      pointerEvents: 'none',
    });
  });

  it('stateCss 가 컴포넌트 루트에 적용된다', () => {
    const c = createSaleComponent('text', 't');
    c.content = '본문';
    c.stateCss = { scheduled: { letterSpacing: '3px' } };

    expect(render(c, 'scheduled')).toContain('letter-spacing:3px');
    expect(render(c, 'ended')).not.toContain('letter-spacing:3px');
  });

  it('productTexts 가 있으면 options.header 를 쓰지 않는다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.header = 'HEADER_OPTION';
    c.options.footer = 'FOOTER_OPTION';
    c.productTexts = [
      { id: 'a', position: 'header', content: 'TEXT_ONE', css: {} },
      { id: 'b', position: 'footer', content: 'TEXT_TWO', css: {} },
    ];

    const html = render(c, 'active');

    expect(html).toContain('TEXT_ONE');
    expect(html).toContain('TEXT_TWO');
    expect(html).not.toContain('HEADER_OPTION');
    expect(html).not.toContain('FOOTER_OPTION');
  });

  it('productTexts 가 비어 있으면 options.header 를 쓴다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.header = 'HEADER_OPTION';

    expect(render(c, 'active')).toContain('HEADER_OPTION');
  });

  it('productTexts 는 이미지 위(머리말)와 아래(꼬리말)에 배열 순서대로 놓인다', () => {
    const c = createSaleComponent('grid', 'g');
    c.productTexts = [
      { id: 'a', position: 'footer', content: 'FOOT_1', css: {} },
      { id: 'b', position: 'header', content: 'HEAD_1', css: {} },
      { id: 'c', position: 'header', content: 'HEAD_2', css: {} },
      { id: 'd', position: 'footer', content: 'FOOT_2', css: {} },
    ];

    const html = render(c, 'active', [{ ...product, image: '/img.png' }]);
    const at = (text: string) => html.indexOf(text);

    expect(at('HEAD_1')).toBeGreaterThan(-1);
    expect(at('HEAD_1')).toBeLessThan(at('HEAD_2'));
    expect(at('HEAD_2')).toBeLessThan(at('<img'));
    expect(at('<img')).toBeLessThan(at('FOOT_1'));
    expect(at('FOOT_1')).toBeLessThan(at('FOOT_2'));
  });

  it('badgeCss 가 배지에, imageCss 가 이미지에 적용된다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.badge = 'tag';
    c.options.badgeCss = { letterSpacing: '7px' };
    c.options.imageCss = { filter: 'blur(2px)' };

    const html = render(c, 'active', [{ ...product, image: '/img.png' }]);
    const img = html.match(/<img[^>]*>/)?.[0] ?? '';

    expect(html).toContain('letter-spacing:7px');
    expect(img).toContain('filter:blur(2px)');
  });
});

describe('상품별 기간', () => {
  const sale = {
    startsAt: '2026-10-07T13:00:00+09:00',
    endsAt: '2026-10-07T16:00:00+09:00',
  };
  const a = {
    startsAt: '2026-10-07T13:00:00+09:00',
    endsAt: '2026-10-07T14:00:00+09:00',
  };
  const b = {
    startsAt: '2026-10-07T15:00:00+09:00',
    endsAt: '2026-10-07T16:00:00+09:00',
  };
  const at = (time: string) => Date.parse(`2026-10-07T${time}:00+09:00`);

  it('(c) 13:30 이면 섹션은 A 기간, A 카드는 할인, B 카드는 예정', () => {
    const now = at('13:30');

    expect(resolveSectionPeriod(now, sale, [a, b])).toEqual(a);
    expect(resolveProductState(now, a, sale)).toBe('active');
    expect(resolveProductState(now, b, sale)).toBe('scheduled');

    const c = createSaleComponent('grid', 'g');
    c.options.scheduledCss = { opacity: 0.3 };

    expect(productStyle(c, resolveProductState(now, b, sale), false)).toEqual({
      opacity: 0.3,
    });
  });

  it('(d) 14:30 이면 섹션은 B 예정, A 카드는 마감', () => {
    const now = at('14:30');

    expect(resolveSectionPeriod(now, sale, [a, b])).toEqual(b);
    expect(resolveProductState(now, a, sale)).toBe('ended');
    expect(resolveProductState(now, b, sale)).toBe('scheduled');
  });

  it('진행 중인 상품이 여럿이면 가장 먼저 끝나는 기간을 따른다', () => {
    const long = {
      startsAt: '2026-10-07T13:00:00+09:00',
      endsAt: '2026-10-07T18:00:00+09:00',
    };

    expect(resolveSectionPeriod(at('13:30'), sale, [long, a])).toEqual(a);
  });

  it('상품 기간이 없으면 세일 기간을 쓴다', () => {
    expect(resolveSectionPeriod(at('13:30'), sale, [{}])).toEqual(sale);
    expect(resolveProductState(at('15:30'), {}, sale)).toBe('active');
  });

  it('카드 변수에 상품 시작·종료·남은 시간이 들어간다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.header =
      '[{{product_starts_at}}|{{product_ends_at}}|{{product_remaining}}]';

    const html = render(c, 'active', [{ ...product, ...a }]);

    expect(html).toContain(new Date(a.startsAt).toLocaleString('ko-KR'));
    expect(html).toContain(new Date(a.endsAt).toLocaleString('ko-KR'));
    expect(html).toMatch(/\|\d+시간 \d+분\]/);
  });
});

describe('렌더러 옵션', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    ...product,
    id: `p${i}`,
  }));

  afterEach(() => jest.useRealTimers());

  it('(a) 고정 기준에서 2초가 지나면 남은 초가 2 줄어든다', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-07T00:00:00Z'));

    const anchor = previewAnchorFor('active', Date.now());
    const before = previewRemainingSeconds(anchor, 'active', Date.now());

    jest.advanceTimersByTime(2000);

    expect(previewRemainingSeconds(anchor, 'active', Date.now())).toBe(
      before - 2
    );
  });

  it('(b) dots 가 true 면 페이지 수만큼 점 버튼, false 면 0개', () => {
    const c = createSaleComponent('carousel', 'c');
    c.options.columns = 2;
    c.options.dots = true;

    const count = (html: string) =>
      (html.match(/aria-label="\d+번째 위치"/g) ?? []).length;

    expect(count(render(c, 'active', many))).toBe(4);

    c.options.dots = false;

    expect(count(render(c, 'active', many))).toBe(0);
  });

  it('(c) imageSize 는 이미지 max-width px 로 적용된다', () => {
    const c = createSaleComponent('grid', 'g');
    const settings = defaultTimeSaleSettings();
    settings.environment.imageSize = 300;
    settings.styles.main.pc.components = [c];

    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        settings,
        surface: 'main',
        platform: 'pc',
        saleId: 's1',
        title: '세일',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-01-02T00:00:00Z',
        products: [{ ...product, image: '/img.png' }],
        previewState: 'active',
        sanitizeHtml: (v: string) => v,
      })
    );

    expect(html.match(/<img[^>]*>/)?.[0]).toContain('max-width:300px');
  });

  it('(d) 배지 11종이 모두 BADGE_SHAPES 에 있다', () => {
    const keys = [
      'flower',
      'star',
      'drop',
      'tag',
      'arrow',
      'bag',
      'snowman',
      'tree',
      'ornament',
      'circle',
      'ribbon',
    ];

    expect(Object.keys(BADGE_SHAPES).sort()).toEqual([...keys].sort());
  });

  it('플립 타이머는 keyframes 와 reduced-motion 규칙을 낸다', () => {
    const c = createSaleComponent('timer', 't');
    c.options.timer = 'flip';

    const html = render(c, 'active');

    expect(html).toContain('@keyframes ts-flip-fold-top');
    expect(html).toContain('prefers-reduced-motion');
  });

  it('페이지 시작 위치는 columns 개마다 첫 카드로 잡힌다', () => {
    const offsets = [0, 100, 200, 300, 400, 500, 600, 700];

    expect(pageStarts(offsets, 2)).toEqual([0, 200, 400, 600]);
  });

  it('마지막 페이지는 끝까지 스크롤하면 활성 점이 된다', () => {
    const starts = [0, 200, 400, 600];

    expect(activePageOf(0, starts, 600)).toBe(0);
    expect(activePageOf(190, starts, 600)).toBe(1);
    expect(activePageOf(600, starts, 500)).toBe(3);
    expect(activePageOf(500, starts, 500)).toBe(3);
  });

  it('페이지가 하나여도 dots 가 true 면 점 하나', () => {
    const c = createSaleComponent('carousel', 'c');
    c.options.columns = 4;
    c.options.dots = true;

    const html = render(c, 'active', many.slice(0, 3));

    expect((html.match(/번째 위치/g) ?? []).length).toBe(1);
  });

  it('고정 기준으로 2초 지나면 타이머 초 칸이 2 줄어든다', () => {
    const options = { daysToHours: false, hideZeroDays: false };
    const end = Date.parse('2026-10-08T00:01:05Z');
    const now = Date.parse('2026-10-08T00:00:00Z');
    const seconds = (at: number) => timerParts(end, at, options).at(-1)?.[0];

    expect(seconds(now)).toBe(5);
    expect(seconds(now + 2000)).toBe(3);
  });

  it('플립 타이머가 둘이어도 style 은 한 번만 나간다', () => {
    const c = createSaleComponent('timer', 't');
    c.options.timer = 'flip';

    const settings = defaultTimeSaleSettings();
    settings.styles.main.pc.components = [c, { ...c, id: 't2' }];

    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        settings,
        surface: 'main',
        platform: 'pc',
        saleId: 's1',
        title: '세일',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-01-02T00:00:00Z',
        products: [],
        previewState: 'active',
        sanitizeHtml: (v: string) => v,
      })
    );

    expect((html.match(/<style>/g) ?? []).length).toBe(1);
  });

  it('렌더러가 둘이어도 clipPath id 는 겹치지 않고 참조가 풀린다', () => {
    const c = createSaleComponent('grid', 'g');
    c.options.badge = 'bag';

    const settings = defaultTimeSaleSettings();
    settings.styles.main.pc.components = [c];

    const one = (id: string) =>
      createElement(SaleRenderer, {
        key: id,
        settings,
        surface: 'main',
        platform: 'pc',
        saleId: id,
        title: '세일',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-01-02T00:00:00Z',
        products: [product],
        previewState: 'active',
        sanitizeHtml: (v: string) => v,
      });

    const html = renderToStaticMarkup(
      createElement('div', null, one('a'), one('b'))
    );

    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
    expect(refs.length).toBe(2);
    refs.forEach((ref) => expect(ids).toContain(ref));
  });

  describe('사용자 변수 상품별 값', () => {
    const grid = () => {
      const c = createSaleComponent('grid', 'g');
      c.options.header = '[{{user_x}}]';
      c.options.footer = '';

      return c;
    };

    const renderWith = (products: SaleProduct[], saleVariables = {}) => {
      const settings = defaultTimeSaleSettings();
      settings.variables = [
        { name: 'user_x', description: '', preview: '미리보기값' },
      ];
      settings.styles.main.pc.components = [grid()];
      settings.sales.s1 = {
        ...defaultDisplay(),
        productVariables: saleVariables,
      };

      return renderToStaticMarkup(
        createElement(SaleRenderer, {
          settings,
          surface: 'main',
          platform: 'pc',
          saleId: 's1',
          title: '세일',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-01-02T00:00:00Z',
          products,
          previewState: 'active',
          sanitizeHtml: (html: string) => html,
        })
      );
    };

    it('상품 A 는 자기 값, 값 없는 B 는 변수 preview 값을 쓴다', () => {
      const html = renderWith(
        [
          { ...product, id: 'A', name: 'A상품' },
          { ...product, id: 'B', name: 'B상품' },
        ],
        { A: { user_x: '회원 혜택' } }
      );

      expect(html).toContain('[회원 혜택]');
      expect(html).toContain('[미리보기값]');
      expect(html.match(/\[회원 혜택\]/g)).toHaveLength(1);
    });

    it('이름에 숫자가 든 변수도 치환된다', () => {
      const settings = defaultTimeSaleSettings();
      settings.variables = [
        { name: 'user_audit1007', description: '', preview: '숫자변수값' },
      ];
      const c = createSaleComponent('text', 't');
      c.content = '{{user_audit1007}}';
      settings.styles.main.pc.components = [c];

      const html = renderToStaticMarkup(
        createElement(SaleRenderer, {
          settings,
          surface: 'main',
          platform: 'pc',
          saleId: 's1',
          title: '세일',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-01-02T00:00:00Z',
          products: [product],
          previewState: 'active',
          sanitizeHtml: (h: string) => h,
        })
      );

      expect(html).toContain('숫자변수값');
    });

    it('상품이 직접 넘긴 variables 가 preview 보다 앞선다', () => {
      const defined = [{ name: 'user_x', preview: 'P' }];

      expect(resolveUserVariables(defined, { user_x: 'own' })).toEqual({
        user_x: 'own',
      });
      expect(resolveUserVariables(defined, { user_x: '' })).toEqual({
        user_x: 'P',
      });
      expect(resolveUserVariables(defined, undefined, undefined)).toEqual({
        user_x: 'P',
      });
    });
  });

  it('미리보기 안의 링크 클릭은 이동하지 않는다', () => {
    const preventDefault = jest.fn();
    const target = {
      closest: (selector: string) => (selector === 'a' ? {} : null),
    };

    blockPreviewNavigation({ target, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);

    blockPreviewNavigation({ target: { closest: () => null }, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

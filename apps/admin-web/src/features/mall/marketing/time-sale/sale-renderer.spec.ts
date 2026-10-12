import {
  createSaleComponent,
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  validateSaleCss,
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
  saleTimeVariables,
  resolveProductState,
  resolveSectionPeriod,
  resolveUserVariables,
  blockPreviewNavigation,
  countdownText,
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
  it('이미지의 둥근 모서리는 상태별 CSS까지 반영해 이미지 자체를 자른다', () => {
    const image = createSaleComponent('image');
    image.content = 'https://example.com/image.png';
    image.css.borderRadius = '0 0 12px 12px / 0 0 6px 6px';
    image.stateCss = { active: { borderRadius: '16px' } };

    expect(render(image, 'scheduled')).toMatch(
      /<img[^>]+border-radius:0 0 12px 12px \/ 0 0 6px 6px/
    );
    expect(render(image, 'active')).toMatch(/<img[^>]+border-radius:16px/);
  });
  it('기본 메인 매대는 라이브 홈 섹션(제목·종료까지·더보기·탭·5열 두 줄)과 같다', () => {
    const settings = defaultTimeSaleSettings();
    validateTimeSaleSettings(settings);

    const pc = settings.styles.main.pc;
    expect(pc.css.padding).toBe('48px 40px');
    expect(settings.styles.main.mobile.css.padding).toBe('32px 16px');
    expect(pc.mainCss?.backgroundColor).toBe('#f7f8f9');
    expect(pc.components.map((c) => c.type)).toEqual([
      'text',
      'timer',
      'button',
      'tabs',
      'grid',
    ]);
    expect(pc.components[0].content).toBe('타임세일');
    const timer = pc.components.find((c) => c.type === 'timer');
    expect(timer?.options.timer).toBe('text');
    expect(timer?.content).toBe('종료까지');
    const shelf = pc.components.find((c) => c.type === 'grid');
    expect(shelf?.options.columns).toBe(5);
    expect(shelf?.options.rows).toBe(2);
    expect(shelf?.options.slots).toBe(10);
    expect(shelf?.options.badge).toBe('timesale');
    expect(shelf?.options.membershipLabelOnly).toBe(true);
    expect(settings.styles.main.mobile.components.at(-1)?.type).toBe(
      'carousel'
    );
  });

  it('스토어프론트 액션 슬롯은 품절 마스크 위에서 상품별 버튼을 렌더한다', () => {
    const settings = defaultTimeSaleSettings();
    const markup = renderToStaticMarkup(
      createElement(SaleRenderer, {
        settings,
        surface: 'main',
        platform: 'pc',
        title: '세일',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-01-02T00:00:00Z',
        products: [product],
        previewState: 'active',
        sanitizeHtml: (html: string) => html,
        renderProductActions: (p: SaleProduct) =>
          createElement('button', { 'aria-label': `${p.name} 좋아요` }),
      })
    );

    expect(markup).toContain('class="group"');
    expect(markup).toContain('z-index:100;pointer-events:none');
    expect(markup).toContain('aria-label="상품A 좋아요"');
  });

  it('품절 마스크와 배지는 이미지 크기 안에서만 겹쳐 고정 헤더를 덮지 않는다', () => {
    const c = createSaleComponent('grid', 'sold-out-image');
    c.options.imageWidth = 50;

    const markup = render(c, 'active', [
      { ...product, soldOut: true, image: '/product.jpg' },
    ]);

    expect(markup).toContain('position:relative;isolation:isolate;width:50%');
    expect(markup).toContain('src="/product.jpg"');
    expect(markup).toContain('width:100%;max-width:100%');
    expect(markup).toContain('품절');
  });

  it('실제 매대는 PC 최대 폭과 여백을 가지며 적은 상품은 가운데 모은다', () => {
    const c = createSaleComponent('carousel', 'real-products');
    c.options.columns = 4;

    const markup = render(c, 'active', [product, { ...product, id: 'p2' }]);

    expect(markup).toContain(
      'max-width:1360px;margin:0 auto;position:relative;padding:48px 40px'
    );
    expect(markup).toContain('justify-content:center');
    expect(markup).not.toContain('멤버십 회원 특가');
  });

  it('비공개 멤버십 가격은 주황 안내를 표시하고 숫자나 절약액을 만들지 않는다', () => {
    const c = createSaleComponent('carousel', 'private-products');
    const markup = render(c, 'active', [
      { ...product, membershipOnly: true, membershipPrice: null },
    ]);

    expect(markup).toContain('멤버십할인가');
    expect(markup).toContain('멤버십 회원에게 가격 공개');
    expect(markup).not.toContain('가입 시');
    expect(markup).not.toContain('멤버십 회원 특가');
  });

  it('상품 상단 메시지는 기본 상품명과 가격을 유지하며 선택한 이미지를 표시한다', () => {
    const c = createSaleComponent('carousel', 'images');
    c.options.imageType = 'detail';
    c.productTexts = [
      { id: 'top', position: 'top', content: '상단 안내', css: {} },
    ];

    const markup = render(c, 'active', [
      { ...product, images: { detail: '/detail.png' } },
    ]);

    expect(markup).toContain('상단 안내');
    expect(markup).toContain('상품A');
    expect(markup).toContain('5,000원');
    expect(markup).toContain('src="/detail.png"');
  });

  it('직접 CSS는 여백·그라데이션·마감 효과를 허용하고 주입과 알 수 없는 속성을 거절한다', () => {
    expect(() =>
      validateSaleCss({
        padding: '12px',
        marginLeft: 'auto',
        backgroundImage: 'linear-gradient(90deg, #ffffff, #ffa500)',
        filter: 'grayscale(100%)',
        pointerEvents: 'none',
      })
    ).not.toThrow();
    expect(() =>
      validateSaleCss({ backgroundImage: 'url(javascript:alert(1))' })
    ).toThrow();
    expect(() => validateSaleCss({ unknown: 'red' })).toThrow();
  });

  it('머리말 표시·이미지와 메인 컨테이너 CSS를 별도로 반영한다', () => {
    const settings = defaultTimeSaleSettings();
    const layout = settings.styles.main.pc;
    layout.header = '/banner.png';
    layout.headerOptions = {
      enabled: true,
      type: 'image',
      css: { width: '50%' },
    };
    layout.mainCss = { maxWidth: '900px', margin: '0 auto' };

    const draw = () =>
      renderToStaticMarkup(
        createElement(SaleRenderer, {
          settings,
          surface: 'main',
          platform: 'pc',
          title: '세일',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-01-02T00:00:00Z',
          products: [product],
          previewState: 'active',
          sanitizeHtml: (value: string) => value,
        })
      );

    expect(draw()).toContain('src="/banner.png"');
    expect(draw()).toContain('max-width:900px;margin:0 auto');
    expect(draw()).toContain('width:50%');

    layout.headerOptions.enabled = false;

    expect(draw()).not.toContain('/banner.png');
    expect(() => validateTimeSaleSettings(settings)).not.toThrow();
  });

  it('버튼 주소 이동·새 창·개별 스타일을 반영한다', () => {
    const c = createSaleComponent('button', 'link');
    c.options.buttonAction = 'url';
    c.options.href = '/offers/{{title}}';
    c.options.newWindow = true;
    c.options.buttonCss = {
      width: '45%',
      height: '45px',
      borderRadius: '12px',
    };

    const markup = render(c, 'active');

    expect(markup).toContain('href="/offers/세일"');
    expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
    expect(markup).toContain('width:45%;height:45px');
  });

  it('타이머는 숫자와 콜론을 첫 행, 단위를 둘째 행에 정렬한다', () => {
    const markup = render(
      createSaleComponent('timer', 'aligned-timer'),
      'active'
    );

    expect(markup).toContain('row-gap:8px');
    expect(markup).toContain(
      'grid-row:1;grid-column:2;align-self:center">:</span>'
    );
    expect(markup).toContain('grid-row:2;grid-column:1;text-align:center');
    expect(markup).toContain('line-height:1.25');
  });

  it('타이머 단위·텍스트 구분자·숫자 스타일을 반영한다', () => {
    const c = createSaleComponent('timer', 'timer');
    c.options.showTimerLabels = false;
    c.options.timerSeparators = ['d', 'h', 'm', 's'];
    c.options.timerDigitCss = { padding: '9px', borderRadius: '12px' };

    const markup = render(c, 'active');

    expect(markup).toContain('padding:9px');
    expect(markup).toContain('>h</span>');
    expect(markup).not.toContain('>시간</span>');
    expect(markup).not.toContain('>:</span>');
  });

  it('프로그레스 메시지는 상단·내부·하단의 지정 위치에 놓인다', () => {
    const c = createSaleComponent('progress', 'progress');
    c.progressTexts = [
      { id: 'a', position: 'top', content: 'TOP_MESSAGE', css: {} },
      { id: 'b', position: 'inside', content: 'INSIDE_MESSAGE', css: {} },
      { id: 'c', position: 'bottom', content: 'BOTTOM_MESSAGE', css: {} },
    ];
    c.options.progressCss = { height: '18px', borderRadius: '6px' };

    const markup = render(c, 'active');

    expect(markup.indexOf('TOP_MESSAGE')).toBeLessThan(
      markup.indexOf('role="progressbar"')
    );
    expect(markup.indexOf('INSIDE_MESSAGE')).toBeLessThan(
      markup.indexOf('BOTTOM_MESSAGE')
    );
    expect(markup).toContain('height:18px');
  });

  it('상품 슬롯 상한·역순·이미지 레이어·링크 비활성을 반영한다', () => {
    const c = createSaleComponent('carousel', 'carousel');
    c.options.slots = 1;
    c.options.productOrder = 'reverse';
    c.options.disableProductLink = true;
    c.imageLayers = [
      {
        id: 'layer',
        content: 'LAYER {{product_name}}',
        css: { top: '10%', zIndex: 3 },
      },
    ];

    const markup = render(c, 'active', [
      product,
      { ...product, id: 'p2', name: '상품B' },
    ]);

    expect(markup).toContain('LAYER 상품B');
    expect(markup).not.toContain('상품A');
    expect(markup).not.toContain('href="/p/1"');
    expect(markup).toContain('top:10%;z-index:3');
  });

  it('원본 시간 변수와 조건 변수는 현재 기간에서 계산된다', () => {
    const variables = saleTimeVariables(
      { startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-02T00:00:00Z' },
      'scheduled',
      90061
    );

    expect(variables.remaining_days).toBe('01');
    expect(variables.remaining_hours).toBe('01');
    expect(variables.remaining_minutes).toBe('01');
    expect(variables.remaining_seconds).toBe('01');
    expect(variables.remaining_thours).toBe('25');
    expect(variables.is_before).toBe('true');
    expect(variables.is_running).toBe('');
  });

  it('추가 설정도 저장 단계에서 URL·CSS·수치·레이어 개수를 검증한다', () => {
    const settings = defaultTimeSaleSettings();
    const c = settings.styles.main.mobile.components.find(
      (item) => item.type === 'carousel'
    )!;
    c.options.slideGroup = 2;
    c.options.productHref = '/products/{{product_no}}';
    c.options.listCss = { alignItems: 'flex-start' };

    expect(() => validateTimeSaleSettings(settings)).not.toThrow();

    c.options.productHref = 'javascript:alert(1)';

    expect(() => validateTimeSaleSettings(settings)).toThrow('이동 주소');

    c.options.productHref = '';
    c.options.slots = 0;

    expect(() => validateTimeSaleSettings(settings)).toThrow('슬롯');
  });

  it('타이머의 글자 크기와 색상 편집은 숫자에도 적용된다', () => {
    const c = createSaleComponent('timer', 'styled-timer');
    c.css.fontSize = '20px';
    c.css.color = '#f04452';

    const markup = render(c, 'active');

    expect(markup).toMatch(/display:block;font-size:20px;[^\"]*color:#f04452/);

    c.stateCss = { active: { fontSize: '18px', color: '#ffa500' } };

    expect(render(c, 'active')).toMatch(
      /display:block;font-size:18px;[^\"]*color:#ffa500/
    );
  });

  it('아몬드영 기본 매대는 저장 가능한 CSS와 모바일·PC 상품 간격을 제공한다', () => {
    const settings = defaultTimeSaleSettings();

    expect(() => validateTimeSaleSettings(settings)).not.toThrow();
    for (const platform of ['mobile', 'pc'] as const) {
      const shelf = settings.styles.main[platform].components.find(
        (item) => item.type === 'carousel' || item.type === 'grid'
      )!;

      expect(shelf.options.imageWidth).toBe(100);
      expect(shelf.options.gap).toBe(16);
      expect(shelf.options.headerCss?.textAlign ?? shelf.css.textAlign).toBe(
        'left'
      );
      expect(shelf.options.badgeColor).toBe('#f54527');
    }
  });

  it('멤버십가와 현재 판매가 기준 절약액을 표시하고 더 비싼 멤버십가는 광고하지 않는다', () => {
    const c = createSaleComponent('carousel', 'membership');
    const markup = render(c, 'active', [{ ...product, membershipPrice: 3990 }]);

    expect(markup).toContain('멤버십할인가');
    expect(markup).toContain('3,990원');
    expect(markup).toContain('가입 시 1,010원 절약');
    expect(markup).toContain('align-items:flex-start;text-align:left');
    expect(markup).toMatch(/<a[^>]*text-align:left/);
    expect(
      render(c, 'active', [{ ...product, membershipPrice: 6000 }])
    ).not.toContain('가입 시');
    expect(
      render(c, 'active', [{ ...product, price: null, membershipPrice: 3990 }])
    ).not.toContain('3,990원');
    expect(
      render(c, 'active', [{ ...product, membershipPrice: null }])
    ).not.toContain('가입 시');
  });

  it('편집 프리뷰에서만 구성요소 선택 버튼을 제공한다', () => {
    const settings = defaultTimeSaleSettings();
    const props = {
      settings,
      surface: 'main' as const,
      platform: 'mobile' as const,
      title: '세일',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-01-02T00:00:00Z',
      products: [product],
      previewState: 'active' as const,
      sanitizeHtml: (html: string) => html,
    };

    const markup = renderToStaticMarkup(
      createElement(SaleRenderer, {
        ...props,
        onPreviewSelect: jest.fn(),
        previewSelected: 'main-mobile-2',
      })
    );

    expect(markup).toContain('aria-label="타이머 편집"');
    expect(markup).toContain('data-sale-component="main-mobile-2"');
    expect(markup).toContain('aria-pressed="true"');
    expect(
      renderToStaticMarkup(createElement(SaleRenderer, props))
    ).not.toContain('data-sale-component');
  });

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

  it('(b) dots는 이동 그룹에 따른 실제 위치 수를 표시하며 숨길 수 있다', () => {
    const c = createSaleComponent('carousel', 'c');
    c.options.columns = 2;
    c.options.dots = true;

    const count = (html: string) =>
      (html.match(/aria-label="\d+번째 위치"/g) ?? []).length;

    expect(count(render(c, 'active', many))).toBe(7);

    c.options.slideGroup = 2;

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
        title: '세일',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-01-02T00:00:00Z',
        products: [{ ...product, image: '/img.png' }],
        previewState: 'active',
        sanitizeHtml: (v: string) => v,
      })
    );

    expect(html).toContain(
      `isolation:isolate;width:${c.options.imageWidth}%;max-width:300px`
    );
    expect(html.match(/<img[^>]*>/)?.[0]).toContain(
      'width:100%;max-width:100%'
    );
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

    const renderWith = (products: SaleProduct[]) => {
      const settings = defaultTimeSaleSettings();
      settings.variables = [
        { name: 'user_x', description: '', preview: '미리보기값' },
      ];
      settings.styles.main.pc.components = [grid()];

      return renderToStaticMarkup(
        createElement(SaleRenderer, {
          settings,
          surface: 'main',
          platform: 'pc',
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
      const html = renderWith([
        {
          ...product,
          id: 'A',
          name: 'A상품',
          variables: { user_x: '회원 혜택' },
        },
        { ...product, id: 'B', name: 'B상품' },
      ]);

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

describe('라이브 섹션 모양', () => {
  const settings = defaultTimeSaleSettings();
  const props = {
    settings,
    surface: 'main' as const,
    platform: 'pc' as const,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-01-02T00:00:00Z',
    products: [product, { ...product, id: 'p2', name: '상품B' }],
    previewState: 'active' as const,
    sanitizeHtml: (html: string) => html,
  };

  it('기본 메인 매대는 제목·종료까지·더보기·탭·타임세일 배지를 그린다', () => {
    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        ...props,
        tabs: [
          { key: 'all', name: '전체', productIds: ['p1', 'p2'] },
          { key: 'lash', name: '속눈썹펌', productIds: ['p2'] },
        ],
      })
    );

    expect(html).toContain('타임세일</div>');
    expect(html).toContain('종료까지');
    expect(html).toContain('더보기');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('속눈썹펌');
    // 상품 두 개 모두 시계 아이콘이 든 「타임세일 · …」 배지를 단다.
    expect(html.match(/<polyline points="12 6 12 12 16 14"/g)).toHaveLength(2);
  });

  it('기본 설정(메인·더보기 × 모바일·PC)은 그대로 저장 검증을 통과한다', () => {
    expect(() =>
      validateTimeSaleSettings(defaultTimeSaleSettings())
    ).not.toThrow();
  });

  it('첫 탭(전체)이 기본 선택이고 탭에 없는 상품은 거른다', () => {
    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        ...props,
        tabs: [{ key: 'lash', name: '속눈썹펌', productIds: ['p2'] }],
      })
    );

    expect(html).toContain('상품B');
    expect(html).not.toContain('상품A');
  });

  it('링크 탭은 상품을 거르지 않는다(서버가 이미 탭별로 나눴다)', () => {
    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        ...props,
        tabs: [
          {
            key: 'lash',
            name: '속눈썹펌',
            productIds: ['p2'],
            href: '/kr/time-sale?tab=lash',
          },
        ],
      })
    );

    expect(html).toContain('href="/kr/time-sale?tab=lash"');
    expect(html).toContain('상품A');
  });

  it('재고 상태 슬롯은 품절이 아닌 상품에만 그린다(라이브 카드와 같다)', () => {
    const html = renderToStaticMarkup(
      createElement(SaleRenderer, {
        ...props,
        products: [
          { ...product, id: 'p1' },
          { ...product, id: 'p2', soldOut: true },
        ],
        renderProductStatus: (p: SaleProduct) =>
          createElement('span', null, `상태-${p.id}`),
      })
    );

    expect(html).toContain('상태-p1');
    expect(html).not.toContain('상태-p2');
  });

  it('카드 배지 남은 시간은 하루 넘으면 N일, 안이면 시:분:초', () => {
    expect(countdownText(4 * 86400 + 3600)).toBe('4일');
    expect(countdownText(3 * 3600 + 62)).toBe('03:01:02');
  });
});

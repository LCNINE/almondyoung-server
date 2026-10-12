/** Shared persisted presentation contract; numeric prices remain in Medusa price lists. */
export type SaleSurface = 'main' | 'more';

export type SalePlatform = 'mobile' | 'pc';

export type SalePreviewState = 'scheduled' | 'active' | 'ended';

export type SaleCss = Record<string, string | number>;

export type SaleComponent = {
  id: string;
  type: 'text' | 'image' | 'button' | 'timer' | 'progress' | 'carousel' | 'grid' | 'tabs';
  name: string;
  content: string;
  css: SaleCss;
  states: SalePreviewState[];
  stateCss?: Partial<Record<SalePreviewState, SaleCss>>;
  productTexts?: { id: string; position: 'top' | 'header' | 'footer' | 'bottom'; content: string; css: SaleCss }[];
  imageLayers?: { id: string; content: string; css: SaleCss }[];
  progressTexts?: { id: string; position: 'top' | 'inside' | 'bottom'; content: string; css: SaleCss }[];
  options: {
    timer: 'normal' | 'flip' | 'text';
    hideZeroDays: boolean;
    daysToHours: boolean;
    columns: number;
    rows: number;
    gap: number;
    autoplay: boolean;
    delay: number;
    duration: number;
    loop: boolean;
    arrows: boolean;
    dots: boolean;
    badge: string;
    badgeColor: string;
    badgeSize: number;
    imageWidth: number;
    imageRadius: number;
    showOriginal: boolean;
    showDiscount: boolean;
    membershipLabelOnly?: boolean;
    productCss?: SaleCss;
    soldOutCss?: SaleCss;
    scheduledCss?: SaleCss;
    endedCss?: SaleCss;
    badgeCss?: SaleCss;
    overlayCss?: SaleCss;
    imageCss?: SaleCss;
    discountCss?: SaleCss;
    tabCss?: SaleCss;
    activeTabCss?: SaleCss;
    headerCss?: SaleCss;
    footerCss?: SaleCss;
    listCss?: SaleCss;
    arrowCss?: SaleCss;
    dotCss?: SaleCss;
    activeDotCss?: SaleCss;
    pageCss?: SaleCss;
    activePageCss?: SaleCss;
    showPages?: boolean;
    pageWindow?: number;
    timerDigitCss?: SaleCss;
    timerLabelCss?: SaleCss;
    timerSeparatorCss?: SaleCss;
    buttonCss?: SaleCss;
    progressCss?: SaleCss;
    progressFillCss?: SaleCss;
    showTimerLabels?: boolean;
    timerLabels?: string[];
    timerSeparators?: string[];
    buttonAction?: 'more' | 'url';
    href?: string;
    newWindow?: boolean;
    disableProductLink?: boolean;
    productHref?: string;
    productOrder?: 'priority' | 'reverse' | 'random';
    slots?: number;
    carouselRows?: boolean;
    slideGroup?: number;
    direction?: 'column' | 'row';
    imageContentGap?: number;
    imageType?: 'list' | 'detail' | 'small' | 'thumbnail';
    dotShape?: 'circle' | 'square' | 'number';
    overlay: string;
    header: string;
    footer: string;
    progressColor: string;
    progressBackground: string;
  };
};

export type SaleLayout = {
  id: string;
  name: string;
  header: string;
  footer: string;
  css: SaleCss;
  components: SaleComponent[];
  mainCss?: SaleCss;
  headerOptions?: { enabled: boolean; type: 'text' | 'image'; css: SaleCss };
  footerOptions?: { enabled: boolean; type: 'text' | 'image'; css: SaleCss };
};

// 사용자 변수 이름 문법. 검증기와 문구 치환기가 같은 식을 쓴다.
export const USER_VARIABLE_NAME_SOURCE = 'user_[a-z][a-z0-9_]{0,29}';

export const MAX_USER_VARIABLES = 5;

// 타임세일 전체 설정. Medusa Store.metadata 에 저장되고 숫자 가격은 가격표가 들고 있다.
export type TimeSaleSettings = {
  version: 1;
  environment: {
    rounding: 'round' | 'ceil' | 'floor';
    imageSize: number;
    currencyPrefix: string;
    currencySuffix: string;
    main: boolean;
    more: boolean;
    moreMode: 'page' | 'popup';
    popupWidth: number;
    popupHeight: number;
    veilOpacity: number;
  };
  styles: Record<SaleSurface, Record<SalePlatform, SaleLayout>>;
  savedStyles: SaleLayout[];
  variables: { name: string; description: string; preview: string }[];
};

const defaultComponentContent = (type: SaleComponent['type']) => {
  if (type === 'text') return '{{title}}';
  if (type === 'button') return '더보기';
  if (type === 'timer') return '종료까지';

  return '';
};

// 스타일 편집기에서 새 컴포넌트를 만들 때 쓰는 기본값.
export const createSaleComponent = (type: SaleComponent['type'], id = `${type}-${Date.now()}`): SaleComponent => ({
  id,
  type,
  name: {
    text: '텍스트',
    image: '이미지',
    button: '버튼',
    timer: '타이머',
    progress: '프로그레스',
    carousel: '상품 캐러셀',
    grid: '상품 그리드',
    tabs: '카테고리 탭',
  }[type],
  content: defaultComponentContent(type),
  css: { textAlign: 'center', padding: '8px', color: '#000000', fontSize: type === 'timer' ? '32px' : '14px' },
  states: ['scheduled', 'active', 'ended'],
  options: {
    timer: 'normal',
    hideZeroDays: true,
    daysToHours: false,
    columns: 2,
    rows: 3,
    gap: 3,
    autoplay: true,
    delay: 2,
    duration: 0.4,
    loop: true,
    arrows: true,
    dots: true,
    badge: 'none',
    badgeColor: '#cc3333',
    badgeSize: 50,
    imageWidth: 95,
    imageRadius: 0,
    showOriginal: true,
    showDiscount: true,
    overlay: '{{sold_out^품절}}',
    header: '{{product_name}}',
    footer: '{{sale_price}}',
    progressColor: '#f5a623',
    progressBackground: '#e9e9e9',
  },
});

// 설정이 한 번도 저장되지 않았을 때의 기본값. 메인은 라이브 홈의 타임세일 섹션(제목 · 종료까지
// 타이머 · 더보기 · 카테고리 탭 · 5열 상품), 더보기는 라이브 /time-sale 페이지와 같은 모습이다.
export function defaultTimeSaleSettings(): TimeSaleSettings {
  const layout = (surface: SaleSurface, platform: SalePlatform): SaleLayout => {
    const mobile = platform === 'mobile';
    const main = surface === 'main';
    const types: SaleComponent['type'][] = main
      ? ['text', 'timer', 'button', 'tabs', mobile ? 'carousel' : 'grid']
      : ['text', 'timer', 'tabs', 'text', 'grid'];

    return {
      id: `${surface}-${platform}`,
      name: '기본 스타일',
      header: '',
      footer: '',
      mainCss: main
        ? { width: '100%', maxWidth: '100%', padding: '0', backgroundColor: '#f7f8f9', borderTop: '1px solid #e5e7eb' }
        : { width: '100%', maxWidth: '100%', padding: '0' },
      css: main
        ? {
            maxWidth: '1360px',
            margin: '0 auto',
            position: 'relative',
            padding: mobile ? '32px 16px' : '48px 40px',
            color: '#000000',
          }
        : { position: 'relative', padding: '0', color: '#000000' },
      components: types.map((type, i) => {
        const c = createSaleComponent(type, `${surface}-${platform}-${i}`);
        c.options.columns = mobile ? 2 : 5;
        c.options.gap = main ? 16 : 12;
        // 더보기는 PC 5열×8행 = 40개씩(라이브와 같다). 모바일도 한 페이지 40개라 2열×20행.
        c.options.rows = main ? 2 : mobile ? 20 : 8;
        c.options.slots = main ? 10 : undefined;
        c.options.carouselRows = type === 'carousel';
        c.options.autoplay = false;
        c.options.arrows = false;
        c.options.dots = false;
        c.options.imageWidth = 100;
        c.options.badge = 'timesale';
        c.options.badgeColor = '#f54527';
        if (type === 'carousel' || type === 'grid') {
          c.css = { padding: main ? '0' : '8px 0 0', textAlign: 'left', fontSize: '17px' };
          c.options.productCss = { color: '#000000', textAlign: 'left' };
          c.options.imageCss = { backgroundColor: '#ffffff', maxWidth: '100%' };
          c.options.listCss = { justifyContent: 'start', rowGap: '24px' };
          c.options.headerCss = { margin: '16px 0 8px', fontSize: '14px', fontWeight: 700, lineHeight: '1.25' };
          // 일반 상품 카드처럼 멤버십가 금액과 「가입 시 N원 절약」까지 보인다.
          c.options.membershipLabelOnly = false;
          c.options.footerCss = { fontSize: '17px', fontWeight: 700 };
          c.options.discountCss = { color: '#f04452' };
          c.options.pageCss = { minWidth: '36px', padding: '6px 8px', borderRadius: '6px', color: '#757575' };
          c.options.activePageCss = { backgroundColor: '#000000', color: '#ffffff' };
        }
        if (type === 'button') {
          c.content = '더보기';
          c.css = {
            position: 'absolute',
            top: mobile ? '40px' : '65px', // 제목+타이머 두 줄의 세로 가운데(라이브 Header 의 items-center)
            right: mobile ? '16px' : '40px',
            color: '#8e8e93',
            fontSize: '14px',
            fontWeight: 500,
          };
          c.options.buttonCss = {
            display: 'inline-flex',
            alignItems: 'center',
            height: '32px',
            border: '0',
            borderRadius: '0',
            padding: '0 12px',
            backgroundColor: 'transparent',
            textDecoration: 'underline',
            textUnderlineOffset: '4px',
          };
        }
        if (type === 'text' && i === 0) {
          c.content = main ? '타임세일' : '타임세일 전체';
          c.css = {
            textAlign: 'left',
            padding: '0',
            fontWeight: 'bold',
            fontSize: main ? (mobile ? '22px' : '26px') : '20px',
            lineHeight: main ? '1.1' : '1.4',
            color: '#191f28',
          };
        }
        if (type === 'text' && i > 0) {
          c.name = '상품 수';
          c.content = '{{product_count}}개 상품';
          c.css = { textAlign: 'left', padding: '14px 0 0', fontSize: '14px', color: '#757575' };
        }
        if (type === 'timer') {
          c.content = '종료까지';
          c.options.timer = 'text';
          c.css = { textAlign: 'left', padding: main ? '15px 0 0' : '8px 0 0' };
          c.options.timerLabelCss = { fontSize: mobile ? '14px' : '15px', fontWeight: 600, color: '#8b95a1' };
          c.options.timerDigitCss = {
            fontSize: mobile ? '20px' : '22px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#191f28',
          };
        }
        if (type === 'tabs') {
          c.name = '카테고리 탭';
          if (main) {
            c.css = {
              padding: '27px 0 36px',
              textAlign: mobile ? 'left' : 'center',
              fontSize: '14px',
              fontWeight: 500,
            };
            c.options.tabCss = {
              padding: mobile ? '8px 12px' : '4px 8px 9px',
              color: 'rgba(0,0,0,.6)',
              lineHeight: '20px',
            };
            c.options.activeTabCss = { color: '#000000', borderBottom: '2px solid #ffa500' };
          } else {
            c.css = { padding: '14px 0 0', textAlign: 'left', fontSize: '14px' };
            c.options.tabCss = {
              padding: '6px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '9999px',
              lineHeight: '20px',
            };
            c.options.activeTabCss = { border: '1px solid #000000', backgroundColor: '#000000', color: '#ffffff' };
          }
        }

        return c;
      }),
    };
  };

  return {
    version: 1,
    environment: {
      rounding: 'round',
      imageSize: 800,
      currencyPrefix: '',
      currencySuffix: '원',
      main: true,
      more: true,
      moreMode: 'page',
      popupWidth: 90,
      popupHeight: 80,
      veilOpacity: 0.5,
    },
    styles: {
      main: { mobile: layout('main', 'mobile'), pc: layout('main', 'pc') },
      more: { mobile: layout('more', 'mobile'), pc: layout('more', 'pc') },
    },
    savedStyles: [],
    variables: [],
  };
}

// 스타일에 허용하는 CSS 속성 화이트리스트. 목록 밖의 속성은 저장 단계에서 거절한다.
const cssKeys = new Set([
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textUnderlineOffset',
  'textAlign',
  'whiteSpace',
  'textOverflow',
  'overflow',
  'boxSizing',
  'lineHeight',
  'letterSpacing',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderColor',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'width',
  'height',
  'maxWidth',
  'minWidth',
  'minHeight',
  'opacity',
  'boxShadow',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'flex',
  'flexDirection',
  'transform',
  'filter',
  'pointerEvents',
  'display',
  'gap',
  'rowGap',
  'alignItems',
  'justifyContent',
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',
  'backgroundRepeat',
]);

// CSS 값 검사: 배경 이미지는 https url 만, 문자열은 256자 이하이며
// 스크립트·주입에 쓰일 구문(url(), expression, @import 등)을 막는다.
function cssValueValid(key: string, value: unknown): boolean {
  if (key === 'backgroundImage') {
    return (
      typeof value === 'string' &&
      value.length <= 256 &&
      (/^url\(["']?https:\/\/[^()"'<>\s]+["']?\)$/.test(value) ||
        /^(?:linear|radial|conic)-gradient\([#a-z0-9\s.,()%+-]+\)$/i.test(value))
    );
  }

  if (typeof value === 'number') return Number.isFinite(value);

  return (
    typeof value === 'string' && value.length <= 256 && !/[{};<>]|url\s*\(|expression|javascript|@import/i.test(value)
  );
}

function cssValid(css: unknown): boolean {
  return (
    !!css &&
    typeof css === 'object' &&
    !Array.isArray(css) &&
    Object.entries(css).every(([key, value]) => cssKeys.has(key) && cssValueValid(key, value))
  );
}

export function validateSaleCss(css: unknown): asserts css is SaleCss {
  if (!css || typeof css !== 'object' || Array.isArray(css)) throw new Error('CSS 객체를 입력하세요.');

  for (const [key, value] of Object.entries(css)) {
    if (!cssKeys.has(key)) throw new Error(`지원하지 않는 CSS 속성: ${key}`);
    if (!cssValueValid(key, value)) throw new Error(`CSS 값을 확인하세요: ${key}`);
  }
}

// 설정 저장·읽기 경계의 검증(250KB 이하, 환경값 범위,
// 스타일·컴포넌트·사용자 변수). 어긋나면 Error.

export function validateTimeSaleSettings(input: unknown): asserts input is TimeSaleSettings {
  // JSON structure is checked before typed access; shared contract cast is confined to this boundary.
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 250000)
    throw new Error('설정 크기가 올바르지 않습니다.');

  const s = input as TimeSaleSettings;
  if (s.version !== 1 || !s.environment || !s.styles || !Array.isArray(s.variables) || !Array.isArray(s.savedStyles))
    throw new Error('설정 형식이 올바르지 않습니다.');

  const e = s.environment;
  const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  const invalid = (
    [
      [['round', 'ceil', 'floor'].includes(e.rounding), '할인 금액 반올림 방식을 다시 고르세요.'],
      [
        Number.isInteger(e.imageSize) && within(e.imageSize, 1, 1500),
        '상품 이미지 크기는 1~1500 사이 정수여야 합니다.',
      ],
      [['page', 'popup'].includes(e.moreMode), '더보기 방식을 다시 고르세요.'],
      [within(e.popupWidth, 10, 100), '팝업 폭은 10~100% 사이여야 합니다.'],
      [within(e.popupHeight, 10, 100), '팝업 최대 높이는 10~100% 사이여야 합니다.'],
      [within(e.veilOpacity, 0, 1), '배경 불투명도는 0~1 사이여야 합니다.'],
    ] as const
  ).find(([ok]) => !ok);
  if (invalid) throw new Error(`환경설정 값이 올바르지 않습니다. ${invalid[1]}`);

  for (const key of ['main', 'more'] as const)
    if (typeof e[key] !== 'boolean') throw new Error('노출 설정은 참/거짓이어야 합니다.');

  if (
    typeof e.currencyPrefix !== 'string' ||
    typeof e.currencySuffix !== 'string' ||
    e.currencyPrefix.length > 20 ||
    e.currencySuffix.length > 20
  )
    throw new Error('통화 표시는 20자 이내로 입력하세요.');

  const layouts = [...s.savedStyles];
  for (const surface of ['main', 'more'] as const)
    for (const platform of ['mobile', 'pc'] as const) {
      if (!s.styles[surface]?.[platform]) throw new Error('모바일/PC 스타일이 필요합니다.');
      layouts.push(s.styles[surface][platform]);
    }

  // 저장 스타일은 최대 50개, 한 스타일의 컴포넌트는 15개까지.
  if (s.savedStyles.length > 50) throw new Error('스타일은 최대 50개입니다.');
  for (const l of layouts) {
    // 스타일(레이아웃) 단위 검사: 필드 타입·길이, 컴포넌트 수·id 중복.
    if (
      !l ||
      typeof l.id !== 'string' ||
      typeof l.name !== 'string' ||
      l.name.length > 100 ||
      typeof l.header !== 'string' ||
      typeof l.footer !== 'string' ||
      !cssValid(l.css) ||
      (l.mainCss !== undefined && !cssValid(l.mainCss)) ||
      !Array.isArray(l.components) ||
      l.components.length > 15 ||
      new Set(l.components.map((c) => c.id)).size !== l.components.length
    )
      throw new Error('스타일 형식이 올바르지 않습니다.');

    for (const slot of ['header', 'footer'] as const) {
      const options = l[`${slot}Options`];

      if (!options) continue;

      if (typeof options.enabled !== 'boolean' || !['text', 'image'].includes(options.type) || !cssValid(options.css))
        throw new Error('머리말/꼬리말 설정을 확인하세요.');

      if (options.type === 'image' && l[slot] && !/^(https?:\/\/|\/(?!\/))/.test(l[slot]))
        throw new Error('이미지 주소는 http(s) 또는 /로 시작해야 합니다.');
    }

    if (l.components.filter((c) => c.type === 'carousel' || c.type === 'grid').length > 1)
      throw new Error('상품 캐러셀/그리드는 하나만 추가할 수 있습니다.');

    for (const c of l.components) {
      if (
        !c ||
        typeof c.id !== 'string' ||
        typeof c.name !== 'string' ||
        typeof c.content !== 'string' ||
        c.content.length > 10000 ||
        !['text', 'image', 'button', 'timer', 'progress', 'carousel', 'grid', 'tabs'].includes(c.type) ||
        !cssValid(c.css) ||
        !Array.isArray(c.states) ||
        c.states.some((v) => !['scheduled', 'active', 'ended'].includes(v)) ||
        !c.options
      )
        throw new Error('컴포넌트 설정이 올바르지 않습니다.');

      if (
        c.stateCss &&
        Object.entries(c.stateCss).some(
          ([key, css]) => !['scheduled', 'active', 'ended'].includes(key) || !cssValid(css),
        )
      )
        throw new Error('상태별 CSS를 확인하세요.');

      // 원본과 같이 상품 문구는 위치별 최대 7개다.
      if (
        c.productTexts &&
        (!Array.isArray(c.productTexts) ||
          c.productTexts.length > 28 ||
          ['top', 'header', 'footer', 'bottom'].some(
            (position) => c.productTexts!.filter((t) => t.position === position).length > 7,
          ) ||
          c.productTexts.some(
            (t) =>
              !t ||
              typeof t.id !== 'string' ||
              !['top', 'header', 'footer', 'bottom'].includes(t.position) ||
              typeof t.content !== 'string' ||
              t.content.length > 2000 ||
              !cssValid(t.css),
          ))
      )
        throw new Error('상품 텍스트는 위치별 최대 7개입니다.');

      const o = c.options;
      for (const [items, limit] of [
        [c.imageLayers, 4],
        [c.progressTexts, 3],
      ] as const) {
        if (
          items !== undefined &&
          (!Array.isArray(items) ||
            items.length > limit ||
            items.some(
              (item) =>
                !item ||
                typeof item.id !== 'string' ||
                typeof item.content !== 'string' ||
                item.content.length > 2000 ||
                !cssValid(item.css) ||
                ('position' in item &&
                  (typeof item.position !== 'string' || !['top', 'inside', 'bottom'].includes(item.position))),
            ))
        )
          throw new Error('레이어/프로그레스 메시지 설정을 확인하세요.');
      }

      for (const key of ['showTimerLabels', 'newWindow', 'disableProductLink', 'carouselRows', 'showPages'] as const)
        if (o[key] !== undefined && typeof o[key] !== 'boolean') throw new Error('표시/이동 옵션을 확인하세요.');

      for (const key of ['timerLabels', 'timerSeparators'] as const)
        if (
          o[key] !== undefined &&
          (!Array.isArray(o[key]) || o[key].length !== 4 || o[key].some((v) => typeof v !== 'string' || v.length > 50))
        )
          throw new Error('타이머 단위/구분자를 확인하세요.');

      for (const [key, values] of [
        ['buttonAction', ['more', 'url']],
        ['productOrder', ['priority', 'reverse', 'random']],
        ['direction', ['column', 'row']],
        ['dotShape', ['circle', 'square', 'number']],
        ['imageType', ['list', 'detail', 'small', 'thumbnail']],
      ] as const)
        if (o[key] !== undefined && !(values as readonly string[]).includes(o[key]))
          throw new Error('컴포넌트 선택 옵션을 확인하세요.');

      for (const [key, max] of [
        ['slots', 200],
        ['slideGroup', 10],
        ['imageContentGap', 100],
        ['pageWindow', 20],
      ] as const)
        if (
          o[key] !== undefined &&
          (!Number.isInteger(o[key]) || o[key] < (key === 'imageContentGap' ? 0 : 1) || o[key] > max)
        )
          throw new Error('상품 슬롯/간격 범위를 확인하세요.');

      for (const key of ['href', 'productHref'] as const)
        if (
          o[key] !== undefined &&
          (typeof o[key] !== 'string' || o[key].length > 2000 || (o[key] && !/^(https?:\/\/|\/(?!\/)|#)/.test(o[key])))
        )
          throw new Error('이동 주소는 http(s), / 또는 #으로 시작해야 합니다.');

      for (const key of [
        'productCss',
        'soldOutCss',
        'scheduledCss',
        'endedCss',
        'badgeCss',
        'overlayCss',
        'imageCss',
        'discountCss',
        'tabCss',
        'activeTabCss',
        'headerCss',
        'footerCss',
        'listCss',
        'arrowCss',
        'dotCss',
        'activeDotCss',
        'pageCss',
        'activePageCss',
        'timerDigitCss',
        'timerLabelCss',
        'timerSeparatorCss',
        'buttonCss',
        'progressCss',
        'progressFillCss',
      ] as const)
        if (o[key] && !cssValid(o[key])) throw new Error('상품 스타일 CSS를 확인하세요.');

      if (
        ['columns', 'rows', 'gap', 'delay', 'duration', 'imageWidth', 'imageRadius', 'badgeSize'].some(
          (key) => typeof o[key as keyof typeof o] !== 'number' || !Number.isFinite(o[key as keyof typeof o]),
        )
      )
        throw new Error('상품 수치 형식을 확인하세요.');

      // 컴포넌트 수치(열·행·간격·딜레이 등) 허용 범위.
      if (
        !['normal', 'flip', 'text'].includes(o.timer) ||
        !Number.isInteger(o.columns) ||
        o.columns < 1 ||
        o.columns > 10 ||
        !Number.isInteger(o.rows) ||
        o.rows < 1 ||
        o.rows > 20 ||
        !Number.isFinite(o.gap) ||
        o.gap < 0 ||
        o.gap > 100 ||
        o.delay < 0.5 ||
        o.delay > 60 ||
        !Number.isFinite(o.delay) ||
        o.duration < 0 ||
        o.duration > 10 ||
        !Number.isFinite(o.duration) ||
        o.imageWidth < 1 ||
        o.imageWidth > 100 ||
        o.imageRadius < 0 ||
        o.imageRadius > 100 ||
        o.badgeSize < 0 ||
        o.badgeSize > 100
      )
        throw new Error('컴포넌트 수치 범위를 확인하세요.');

      for (const key of [
        'hideZeroDays',
        'daysToHours',
        'autoplay',
        'loop',
        'arrows',
        'dots',
        'showOriginal',
        'showDiscount',
      ] as const)
        if (typeof o[key] !== 'boolean') throw new Error('컴포넌트 옵션을 확인하세요.');

      for (const key of [
        'overlay',
        'header',
        'footer',
        'badge',
        'badgeColor',
        'progressColor',
        'progressBackground',
      ] as const)
        if (typeof o[key] !== 'string' || o[key].length > 2000) throw new Error('컴포넌트 텍스트를 확인하세요.');

      for (const key of ['badgeColor', 'progressColor', 'progressBackground'] as const)
        if (!/^#[0-9a-f]{3,8}$/i.test(o[key])) throw new Error('색상은 HEX 형식으로 입력하세요.');

      const hasImageSource = c.type === 'image' && Boolean(c.content);

      const isAllowedImageSource = /^https?:\/\//.test(c.content) || /^\/(?!\/)/.test(c.content);

      if (hasImageSource && !isAllowedImageSource)
        throw new Error('이미지는 HTTPS 주소 또는 사이트 경로로 입력하세요.');
    }
  }

  if (
    // 사용자 변수는 최대 5개, user_ 로 시작하는 영문 소문자 이름만.
    s.variables.length > MAX_USER_VARIABLES ||
    new Set(s.variables.map((v) => v.name)).size !== s.variables.length ||
    s.variables.some(
      (v) =>
        !new RegExp(`^${USER_VARIABLE_NAME_SOURCE}$`).test(v.name) ||
        typeof v.description !== 'string' ||
        v.description.length > 30 ||
        typeof v.preview !== 'string' ||
        v.preview.length > 256,
    )
  )
    throw new Error('사용자 변수는 최대 5개이며 영문 소문자로 시작해야 합니다.');
}

export function pageWindowItems(page: number, pages: number, window: number): (number | 'gap')[] {
  if (pages <= 1) return [];

  const start = Math.max(1, Math.min(page - Math.floor(window / 2), pages - window + 1));
  const end = Math.min(pages, start + window - 1);
  const items: (number | 'gap')[] = [];

  if (start > 1) items.push(1);
  if (start > 2) items.push('gap');
  for (let n = start; n <= end; n++) items.push(n);
  if (end < pages - 1) items.push('gap');
  if (end < pages) items.push(pages);

  return items;
}

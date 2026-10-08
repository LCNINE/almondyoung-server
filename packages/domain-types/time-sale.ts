/** Shared persisted presentation contract; numeric prices remain in Medusa price lists. */
export type SaleSurface = 'main' | 'more' | 'detail';

export type SalePlatform = 'mobile' | 'pc';

export type SalePreviewState = 'scheduled' | 'active' | 'ended';

export type SaleCss = Record<string, string | number>;

export type SaleComponent = {
  id: string;
  type: 'text' | 'image' | 'button' | 'timer' | 'progress' | 'carousel' | 'grid';
  name: string;
  content: string;
  css: SaleCss;
  states: SalePreviewState[];
  stateCss?: Partial<Record<SalePreviewState, SaleCss>>;
  productTexts?: { id: string; position: 'header' | 'footer'; content: string; css: SaleCss }[];
  options: {
    timer: 'normal' | 'flip';
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
    productCss?: SaleCss;
    soldOutCss?: SaleCss;
    scheduledCss?: SaleCss;
    endedCss?: SaleCss;
    badgeCss?: SaleCss;
    overlayCss?: SaleCss;
    imageCss?: SaleCss;
    headerCss?: SaleCss;
    footerCss?: SaleCss;
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
};

// 기간 모드: sale = 세일 전체가 한 기간, product = 상품마다 기간이 따로.
export type SalePeriodMode = 'sale' | 'product';

// 가격표 묶음 하나: 일반·멤버십 가격표 짝과(상품별 기간 모드면) 그 묶음이 맡은 상품.
export type SaleGroup = {
  generalId: string | null;
  membershipId: string | null;
  productId: string | null;
};

// 상품별 기간 모드에서 한 세일에 둘 수 있는 상품(묶음) 수 상한.
export const MAX_PRODUCT_PERIOD_GROUPS = 200;

// 사용자 변수 이름 문법. 검증기와 문구 치환기가 같은 식을 쓴다.
export const USER_VARIABLE_NAME_SOURCE = 'user_[a-z][a-z0-9_]{0,29}';

// 상품별 변수 값의 상한: 상품 수·상품당 변수 수·값 길이(250KB 설정 크기 안에서 넉넉히 잡은 값).
export const MAX_VARIABLE_PRODUCTS = 200;

export const MAX_USER_VARIABLES = 5;

export const MAX_VARIABLE_VALUE_LENGTH = 256;

// 세일 하나의 노출 설정(구좌·반복·공개 제한·가격표 묶음). 설정 JSON 의 sales[saleId] 값이다.
export type SaleDisplay = {
  partitionId: string;
  webId: string;
  showSoldOut: boolean;
  showScheduled: boolean;
  showEnded: boolean;
  membershipPriceOnly: boolean;
  repeatHours: number;
  repeatUntil: string | null;
  main: boolean;
  more: boolean;
  detail: boolean;
  order: number;
  // 상품별 사용자 변수 값: 상품 id → 변수명 → 값. 값이 없으면 변수의 preview 값을 쓴다.
  productVariables: Record<string, Record<string, string>>;
  periodMode: SalePeriodMode;
  groups: SaleGroup[];
};

// 타임세일 전체 설정. Medusa Store.metadata 에 저장되고 숫자 가격은 가격표가 들고 있다.
export type TimeSaleSettings = {
  version: 1;
  environment: {
    enabled: boolean;
    membershipPriceOnly: boolean;
    rounding: 'round' | 'ceil' | 'floor';
    imageSize: number;
    currencyPrefix: string;
    currencySuffix: string;
    main: boolean;
    more: boolean;
    detail: boolean;
    moreMode: 'page' | 'popup';
    popupWidth: number;
    popupHeight: number;
    veilOpacity: number;
    // 서비스를 끌 때 active 였던 타임세일 가격표 id. 켤 때 이것만 되살린다(서버만 쓴다).
    suspendedPriceListIds: string[];
  };
  styles: Record<SaleSurface, Record<SalePlatform, SaleLayout>>;
  savedStyles: SaleLayout[];
  variables: { name: string; description: string; preview: string }[];
  sales: Record<string, SaleDisplay>;
};

export const defaultSaleDisplay = (): SaleDisplay => ({
  partitionId: '',
  webId: '',
  showSoldOut: true,
  showScheduled: false,
  showEnded: false,
  membershipPriceOnly: false,
  repeatHours: 0,
  repeatUntil: null,
  main: true,
  more: true,
  detail: true,
  order: 0,
  productVariables: {},
  periodMode: 'sale',
  groups: [],
});

const defaultComponentContent = (type: SaleComponent['type']) => {
  if (type === 'text') return '{{title}}';
  if (type === 'button') return '더보기';
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

// 설정이 한 번도 저장되지 않았을 때의 기본값(면·기기별 기본 스타일 포함).
export function defaultTimeSaleSettings(): TimeSaleSettings {
  const layout = (surface: SaleSurface, platform: SalePlatform): SaleLayout => {
    const types: SaleComponent['type'][] =
      surface === 'detail'
        ? ['text', 'text', 'timer', 'progress']
        : [
            'text',
            'text',
            'timer',
            ...(platform === 'mobile' ? ['progress' as const] : []),
            surface === 'main' ? 'carousel' : 'grid',
            ...(surface === 'main' ? ['button' as const] : []),
          ];
    return {
      id: `${surface}-${platform}`,
      name: '기본 스타일',
      header: '',
      footer: '',
      css: { maxWidth: '100%', margin: '8px 0', backgroundColor: '#ffffff' },
      components: types.map((type, i) => {
        const c = createSaleComponent(type, `${surface}-${platform}-${i}`);
        c.options.columns = platform === 'mobile' ? 2 : 4;
        c.options.gap = platform === 'mobile' ? 3 : 5;
        c.options.imageWidth = platform === 'mobile' ? 95 : 90;
        if (type === 'text') {
          c.content = surface === 'detail' || i === 1 ? '{{condition}}' : '{{title}}';
          c.css.fontWeight = 'bold';
          c.css.fontSize = '24px';
        }
        return c;
      }),
    };
  };
  return {
    version: 1,
    environment: {
      enabled: true,
      membershipPriceOnly: false,
      rounding: 'round',
      imageSize: 100,
      currencyPrefix: '',
      currencySuffix: '원',
      main: true,
      more: true,
      detail: true,
      moreMode: 'page',
      popupWidth: 90,
      popupHeight: 80,
      veilOpacity: 0.5,
      suspendedPriceListIds: [],
    },
    styles: {
      main: { mobile: layout('main', 'mobile'), pc: layout('main', 'pc') },
      more: { mobile: layout('more', 'mobile'), pc: layout('more', 'pc') },
      detail: { mobile: layout('detail', 'mobile'), pc: layout('detail', 'pc') },
    },
    savedStyles: [],
    variables: [],
    sales: {},
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
  'textAlign',
  'lineHeight',
  'letterSpacing',
  'padding',
  'margin',
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
  'minHeight',
  'opacity',
  'boxShadow',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'transform',
  'display',
  'gap',
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
    return typeof value === 'string' && /^url\(["']?https:\/\/[^()"'<>\s]+["']?\)$/.test(value);
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

// 서비스 OFF 동안 기억해 둘 수 있는 active 가격표 수의 상한.
export const MAX_SUSPENDED_PRICE_LISTS = 200;

// 설정 저장·읽기 경계의 검증(250KB 이하, 환경값 범위,
// 스타일·컴포넌트·사용자 변수·세일별 설정). 어긋나면 Error.
export function validateTimeSaleSettings(input: unknown): asserts input is TimeSaleSettings {
  // JSON structure is checked before typed access; shared contract cast is confined to this boundary.
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 250000)
    throw new Error('설정 크기가 올바르지 않습니다.');

  const s = input as TimeSaleSettings;
  if (
    s.version !== 1 ||
    !s.environment ||
    !s.styles ||
    !Array.isArray(s.variables) ||
    !Array.isArray(s.savedStyles) ||
    !s.sales ||
    Array.isArray(s.sales)
  )
    throw new Error('설정 형식이 올바르지 않습니다.');

  const e = s.environment;
  if (
    !['round', 'ceil', 'floor'].includes(e.rounding) ||
    !Number.isInteger(e.imageSize) ||
    e.imageSize < 1 ||
    e.imageSize > 1500 ||
    !['page', 'popup'].includes(e.moreMode) ||
    e.popupWidth < 10 ||
    e.popupWidth > 100 ||
    e.popupHeight < 10 ||
    e.popupHeight > 100 ||
    e.veilOpacity < 0 ||
    e.veilOpacity > 1 ||
    !Number.isFinite(e.veilOpacity)
  )
    throw new Error('환경설정 값이 올바르지 않습니다.');

  for (const key of ['enabled', 'membershipPriceOnly', 'main', 'more', 'detail'] as const)
    if (typeof e[key] !== 'boolean') throw new Error('노출 설정은 참/거짓이어야 합니다.');

  // 이 필드가 없던 옛 설정은 빈 목록으로 읽는다. 상한 200개는 저장 크기(250KB) 안에서 넉넉히 잡은 값.
  const suspended: unknown = e.suspendedPriceListIds;
  if (
    suspended !== undefined &&
    (!Array.isArray(suspended) ||
      suspended.length > MAX_SUSPENDED_PRICE_LISTS ||
      suspended.some((id) => typeof id !== 'string' || !id || id.length > 100))
  )
    throw new Error(`중지된 가격표 목록이 올바르지 않습니다(최대 ${MAX_SUSPENDED_PRICE_LISTS}개).`);

  if (
    typeof e.currencyPrefix !== 'string' ||
    typeof e.currencySuffix !== 'string' ||
    e.currencyPrefix.length > 20 ||
    e.currencySuffix.length > 20
  )
    throw new Error('통화 표시는 20자 이내로 입력하세요.');

  const layouts = [...s.savedStyles];
  for (const surface of ['main', 'more', 'detail'] as const)
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
      !Array.isArray(l.components) ||
      l.components.length > 15 ||
      new Set(l.components.map((c) => c.id)).size !== l.components.length
    )
      throw new Error('스타일 형식이 올바르지 않습니다.');

    if (l.components.filter((c) => c.type === 'carousel' || c.type === 'grid').length > 1)
      throw new Error('상품 캐러셀/그리드는 하나만 추가할 수 있습니다.');

    for (const c of l.components) {
      if (
        !c ||
        typeof c.id !== 'string' ||
        typeof c.name !== 'string' ||
        typeof c.content !== 'string' ||
        c.content.length > 10000 ||
        !['text', 'image', 'button', 'timer', 'progress', 'carousel', 'grid'].includes(c.type) ||
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

      // 상품 문구는 헤더/푸터 합쳐 최대 7개(상품 카드가 길어지는 걸 막는 제한).
      if (
        c.productTexts &&
        (!Array.isArray(c.productTexts) ||
          c.productTexts.length > 7 ||
          c.productTexts.some(
            (t) =>
              !t ||
              typeof t.id !== 'string' ||
              !['header', 'footer'].includes(t.position) ||
              typeof t.content !== 'string' ||
              t.content.length > 2000 ||
              !cssValid(t.css),
          ))
      )
        throw new Error('상품 텍스트는 최대 7개입니다.');

      const o = c.options;
      for (const key of [
        'productCss',
        'soldOutCss',
        'scheduledCss',
        'endedCss',
        'badgeCss',
        'overlayCss',
        'imageCss',
        'headerCss',
        'footerCss',
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
        !['normal', 'flip'].includes(o.timer) ||
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

  // 세일별 노출 설정 검사(반복 간격은 최대 8760시간 = 1년).
  for (const [id, d] of Object.entries(s.sales)) {
    if (
      !isSaleKey(id) ||
      !d ||
      typeof d.partitionId !== 'string' ||
      d.partitionId.length > 10 ||
      typeof d.webId !== 'string' ||
      d.webId.length > 10 ||
      !Number.isFinite(d.order) ||
      !Number.isFinite(d.repeatHours) ||
      d.repeatHours < 0 ||
      d.repeatHours > 8760 ||
      (d.repeatUntil !== null && !Number.isFinite(Date.parse(d.repeatUntil)))
    )
      throw new Error('타임세일 노출 설정을 확인하세요.');

    for (const key of [
      'showSoldOut',
      'showScheduled',
      'showEnded',
      'membershipPriceOnly',
      'main',
      'more',
      'detail',
    ] as const)
      if (typeof d[key] !== 'boolean') throw new Error('타임세일 옵션을 확인하세요.');

    validateProductVariables(d.productVariables, s.variables);

    validateSaleGroups(d);
  }
}

// 세일 키: 옛 세일은 가격표 id(plist_…), 새 세일은 UUID(saleId).
const LEGACY_SALE_KEY = /^plist_[a-zA-Z0-9]+$/;

const SALE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isSaleKey = (key: string) => LEGACY_SALE_KEY.test(key) || SALE_ID.test(key);

export const isSaleId = (key: string) => SALE_ID.test(key);

const isListId = (value: unknown) => value === null || (typeof value === 'string' && LEGACY_SALE_KEY.test(value));

// 상품별 변수 값 검사: 옛 설정엔 필드가 없으므로 undefined 는 빈 값으로 읽는다.
// 상품 200개, 상품당 변수 5개, 값 256자 이하이며 정의된 변수 이름만 쓸 수 있다.
function validateProductVariables(input: unknown, defined: { name: string }[]) {
  if (input === undefined) return;

  const fail = () => {
    throw new Error('사용자 변수 값을 확인하세요.');
  };

  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_VARIABLE_PRODUCTS) fail();

  for (const [productId, values] of entries) {
    if (!productId || productId.length > 64 || !values || typeof values !== 'object' || Array.isArray(values)) fail();

    const pairs = Object.entries(values as Record<string, unknown>);
    if (pairs.length > MAX_USER_VARIABLES) fail();

    for (const [name, value] of pairs)
      if (
        !defined.some((v) => v.name === name) ||
        typeof value !== 'string' ||
        value.length > MAX_VARIABLE_VALUE_LENGTH
      )
        fail();
  }
}

// 기간 모드와 가격표 묶음의 일관성 검사: sale 은 묶음 1개, product 는 상품마다 1개(200개 상한).
function validateSaleGroups(d: Partial<SaleDisplay>) {
  if (d.periodMode === undefined && d.groups === undefined) return;

  const groups = d.groups;
  if (!['sale', 'product'].includes(d.periodMode ?? '') || !Array.isArray(groups))
    throw new Error('타임세일 기간 구분을 확인하세요.');

  const invalidGroup = groups.some(
    (g) =>
      !g ||
      !isListId(g.generalId) ||
      !isListId(g.membershipId) ||
      (g.productId !== null && (typeof g.productId !== 'string' || !g.productId || g.productId.length > 64)),
  );
  if (invalidGroup) throw new Error('타임세일 가격표 묶음을 확인하세요.');

  if (d.periodMode === 'sale') {
    if (groups.length > 1 || groups.some((g) => g.productId !== null))
      throw new Error('세일 단위 기간은 가격표 묶음이 하나입니다.');
    return;
  }

  const productIds = groups.map((g) => g.productId);
  if (groups.length > MAX_PRODUCT_PERIOD_GROUPS) throw new Error('상품별 기간은 상품 200개까지입니다.');
  if (productIds.some((id) => id === null) || new Set(productIds).size !== productIds.length)
    throw new Error('상품별 기간은 상품마다 하나씩입니다.');
}

// 반복 세일이 끝났을 때 다음 회차 기간. 반복 간격이 (기간 +
// 10분)보다 짧거나 아직 안 끝났거나 반복 종료일을 넘으면 null.
export function nextRepeatedPeriod(start: string, end: string, hours: number, until: string | null, now = Date.now()) {
  const a = Date.parse(start),
    b = Date.parse(end),
    interval = hours * 3600000;

  if (!Number.isFinite(a + b + interval) || interval <= 0 || b <= a || interval < b - a + 600000 || now < b)
    return null;

  const steps = Math.floor((now - b) / interval) + 1;
  const nextStart = a + steps * interval,
    nextEnd = b + steps * interval;

  if (until && nextEnd > Date.parse(until)) return null;

  return { startsAt: new Date(nextStart).toISOString(), endsAt: new Date(nextEnd).toISOString() };
}

// 한 회차가 끝난 뒤 다음 회차가 시작하기까지 최소로 비워 두는 간격(10분).
export const REPEAT_GAP_MS = 600000;

// 반복 간격이 (기간 + 10분)보다 짧은 기간을 찾는다(없으면 null).
export function repeatTooShortFor<T extends { startsAt: string; endsAt: string }>(
  repeatHours: number,
  periods: T[],
): T | null {
  if (!(repeatHours > 0)) return null;

  const interval = repeatHours * 3600000;

  return (
    periods.find((period) => interval < Date.parse(period.endsAt) - Date.parse(period.startsAt) + REPEAT_GAP_MS) ?? null
  );
}

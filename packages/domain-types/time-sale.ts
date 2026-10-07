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
  variables: Record<string, string>;
};

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
  variables: {},
});

const defaultComponentContent = (type: SaleComponent['type']) => {
  if (type === 'text') return '{{title}}';
  if (type === 'button') return '더보기';
  return '';
};

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

  if (s.savedStyles.length > 50) throw new Error('스타일은 최대 50개입니다.');
  for (const l of layouts) {
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
    s.variables.length > 5 ||
    new Set(s.variables.map((v) => v.name)).size !== s.variables.length ||
    s.variables.some(
      (v) =>
        !/^user_[a-z][a-z0-9_]{0,29}$/.test(v.name) ||
        typeof v.description !== 'string' ||
        v.description.length > 30 ||
        typeof v.preview !== 'string' ||
        v.preview.length > 256,
    )
  )
    throw new Error('사용자 변수는 최대 5개이며 영문 소문자로 시작해야 합니다.');

  for (const [id, d] of Object.entries(s.sales)) {
    if (
      !/^plist_[a-zA-Z0-9]+$/.test(id) ||
      !d ||
      typeof d.partitionId !== 'string' ||
      d.partitionId.length > 10 ||
      typeof d.webId !== 'string' ||
      d.webId.length > 10 ||
      !Number.isFinite(d.order) ||
      !Number.isFinite(d.repeatHours) ||
      d.repeatHours < 0 ||
      d.repeatHours > 8760 ||
      (d.repeatUntil !== null && !Number.isFinite(Date.parse(d.repeatUntil))) ||
      !d.variables ||
      Array.isArray(d.variables)
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

    if (
      Object.entries(d.variables).some(
        ([key, value]) => !s.variables.some((v) => v.name === key) || typeof value !== 'string' || value.length > 256,
      )
    )
      throw new Error('사용자 변수 값을 확인하세요.');
  }
}

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

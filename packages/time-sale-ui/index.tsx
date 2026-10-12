'use client';

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  USER_VARIABLE_NAME_SOURCE,
  pageWindowItems,
  type TimeSaleSettings,
  type SaleSurface,
  type SalePlatform,
  type SalePreviewState,
  type SaleComponent,
  type SaleCss,
  type SaleLayout,
} from '../domain-types/time-sale';

// 렌더러가 받는 상품 한 칸. price 가 null 이면 가격 공개 제한 상품(멤버십 회원에게만 공개 문구).
export type SaleProduct = {
  id: string;
  name: string;
  image?: string | null;
  images?: Partial<Record<'list' | 'detail' | 'small' | 'thumbnail', string | null>>;
  summary?: string | null;
  modelName?: string | null;
  href: string;
  price: number | null;
  originalPrice: number | null;
  membershipPrice?: number | null;
  rating?: number;
  reviewCount?: number;
  soldOut: boolean;
  variables?: Record<string, string>;
  startsAt?: string | null;
  endsAt?: string | null;
  membershipOnly?: boolean;
  // 멤버십 세일가만 있는 상품(멤버십 전용 특가). 배지·멤버십가 문구가 「멤버십 특가」로 바뀐다.
  membershipSale?: boolean;
  quickActions?: {
    handle: string;
    variantId?: string;
    currency?: string;
    isSingleOption: boolean;
    membersOnlyPurchase: boolean;
    isWelcomeMembership: boolean;
    isWishlisted: boolean;
  };
};

// 서버 페이지 나누기용 페이지 링크 한 칸. href 가 없으면 말줄임이다.
export type SalePagerItem = { label: string; href?: string; current?: boolean };

export type SalePeriod = { startsAt: string; endsAt: string };

// 상품별 기간(없으면 세일 전체 기간을 쓴다).
export type SalePeriodLike = { startsAt?: string | null; endsAt?: string | null };

export type SaleRendererProps = {
  settings: TimeSaleSettings;
  surface: SaleSurface;
  platform?: SalePlatform;
  // 고객 화면 제목엔 쓰지 않는다(운영자 내부용). 어드민 미리보기의 {{title}} 치환용.
  title?: string;
  startsAt: string;
  endsAt: string;
  products: SaleProduct[];
  previewState?: SalePreviewState;
  previewAnchor?: SalePeriod;
  previewSoldOut?: boolean;
  onPreviewSelect?: (id: string) => void;
  previewSelected?: string;
  sanitizeHtml: (html: string) => string;
  moreHref?: string | ((platform: SalePlatform) => string);
  renderProductActions?: (product: SaleProduct) => ReactNode;

  // 가격 아래 재고 상태(일부 품절·N개 남음 등). 스토어프론트가 상품 카드와 같은 컴포넌트를 넣는다.
  renderProductStatus?: (product: SaleProduct) => ReactNode;

  // 더보기 팝업 안을 호스트가 채운다(스토어프론트는 더보기 페이지와 같은 데이터를 받아 그린다).
  // 없으면 지금 받은 상품으로 더보기 레이아웃을 그린다(어드민 미리보기).
  renderMorePopup?: () => ReactNode;

  // 있으면 그리드는 받은 상품을 한 페이지로 그대로 그리고 링크형 페이지 번호를 둔다.
  // 더보기 서버 페이지네이션용.
  pager?: SalePagerItem[];

  // 섹션 타이머·진행바·노출 판단의 기준 기간들. 없으면 받은 상품으로 계산한다.
  sectionPeriods?: SalePeriodLike[];

  // 카테고리 탭. 첫 칸이 「전체」다. 없으면 탭 컴포넌트는 그리지 않는다.
  tabs?: SaleTab[];

  // 링크 탭에서 지금 고른 탭, 그리고 {{product_count}} 에 쓸 전체 상품 수(서버 페이지 나누기용).
  activeTabKey?: string;
  productCount?: number;
};

// href 가 있으면 링크 탭(서버가 탭별로 페이지를 나눌 때), 없으면 받은 상품을 화면에서 거른다.
export type SaleTab = { key: string; name: string; productIds: string[]; href?: string };

const names = { scheduled: '할인(예정)', active: '할인(실행중)', ended: '할인(종료)' };

export function saleTimeVariables(period: SalePeriod, state: SalePreviewState, remaining: number) {
  const parts = timerParts(remaining * 1000, 0, { daysToHours: false, hideZeroDays: false });
  const values: Record<string, string> = {
    remaining_days: String(parts[0][0]).padStart(2, '0'),
    remaining_hours: String(parts[1][0]).padStart(2, '0'),
    remaining_minutes: String(parts[2][0]).padStart(2, '0'),
    remaining_seconds: String(parts[3][0]).padStart(2, '0'),
    remaining_thours: String(Math.floor(remaining / 3600)),
    remaining_simple_time: formatRemaining(remaining),
    is_before: state === 'scheduled' ? 'true' : '',
    is_running: state === 'active' ? 'true' : '',
    is_after: state === 'ended' ? 'true' : '',
  };
  const total = (Date.parse(period.endsAt) - Date.parse(period.startsAt)) / 1000;
  values.remaining_percent = String(Math.round(Math.min(100, Math.max(0, (remaining / Math.max(1, total)) * 100))));

  for (const [prefix, date] of [
    ['begin', new Date(period.startsAt)],
    ['end', new Date(period.endsAt)],
  ] as const) {
    values[`${prefix}_datetime`] = date.toLocaleString('ko-KR');
    for (const [key, value] of [
      ['year', date.getFullYear()],
      ['month', date.getMonth() + 1],
      ['day', date.getDate()],
      ['hour', date.getHours()],
      ['minute', date.getMinutes()],
      ['second', date.getSeconds()],
    ] as const)
      values[`${prefix}_${key}`] = String(value).padStart(2, '0');
  }

  return values;
}

export function SaleMembershipPrice({
  price,
  membershipPrice,
  hidden = false,
  labelOnly = false,
  membershipSale = false,
  currency = (amount: number) => `${amount.toLocaleString('ko-KR')}원`,
}: {
  price: number | null;
  membershipPrice?: number | null;
  hidden?: boolean;
  // 라이브 카드처럼 「멤버십할인가」 표시만 두고 금액·절약액은 뺀다.
  labelOnly?: boolean;
  membershipSale?: boolean;
  currency?: (amount: number) => string;
}) {
  const available = !(
    price === null ||
    !Number.isFinite(price) ||
    typeof membershipPrice !== 'number' ||
    !Number.isFinite(membershipPrice) ||
    membershipPrice <= 0 ||
    membershipPrice >= price
  );

  if (!available && !hidden) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        textAlign: 'left',
        gap: 4,
        marginTop: labelOnly ? 4 : 8,
        color: '#ffa500',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: '#ffa500',
            color: 'white',
            fontSize: 8,
          }}
        >
          ✓
        </span>
        {membershipSale ? '멤버십 특가' : '멤버십할인가'}
      </span>
      {labelOnly ? null : available ? (
        <>
          <strong style={{ fontSize: 15 }}>{currency(membershipPrice!)}</strong>
          <span style={{ fontSize: 11, fontWeight: 500 }}>
            {membershipSale ? '' : '가입 시 '}
            {currency(price! - membershipPrice!)} 절약
          </span>
        </>
      ) : (
        <span style={{ fontSize: 11, fontWeight: 500 }}>멤버십 회원에게 가격 공개</span>
      )}
    </div>
  );
}

function formatToken(value: string, format?: string) {
  if (!value) return '';
  if (format?.includes('?')) return format.replace('?', value);

  return format ?? value;
}

// 예정/진행/종료 판정. 종료 시각 정각부터 종료.
function resolveState(now: number, startsAt: string, endsAt: string): SalePreviewState {
  if (now < Date.parse(startsAt)) return 'scheduled';
  if (now >= Date.parse(endsAt)) return 'ended';

  return 'active';
}

// 상품 자기 기간이 있으면 그것, 없는 쪽은 세일 기간으로 채운다.
const periodOf = (product: SalePeriodLike, sale: SalePeriod): SalePeriod => ({
  startsAt: product.startsAt ?? sale.startsAt,
  endsAt: product.endsAt ?? sale.endsAt,
});

// 상품 한 개의 상태.
export function resolveProductState(now: number, product: SalePeriodLike, sale: SalePeriod): SalePreviewState {
  const period = periodOf(product, sale);

  return resolveState(now, period.startsAt, period.endsAt);
}

// 섹션(타이머·진행바)이 따라갈 기간: 진행 중인 상품 중 마감
// 임박 > 예정 중 시작 임박 > 모두 끝났으면 가장 늦게 끝난 기간.
export function resolveSectionPeriod(now: number, sale: SalePeriod, products: SalePeriodLike[]): SalePeriod {
  const periods = products.map((product) => periodOf(product, sale));

  const byEnd = (a: SalePeriod, b: SalePeriod) => Date.parse(a.endsAt) - Date.parse(b.endsAt);

  const byStart = (a: SalePeriod, b: SalePeriod) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

  const active = periods.filter((p) => resolveState(now, p.startsAt, p.endsAt) === 'active').sort(byEnd);
  if (active[0]) return active[0];

  const upcoming = periods.filter((p) => resolveState(now, p.startsAt, p.endsAt) === 'scheduled').sort(byStart);
  if (upcoming[0]) return upcoming[0];

  return periods.sort(byEnd).at(-1) ?? sale;
}

export type SectionInput = {
  sale: SalePeriod;
  products: SaleProduct[];
  sectionPeriods?: SalePeriodLike[];
  display: { showScheduled: boolean; showEnded: boolean };
  previewState?: SalePreviewState;
  paged?: boolean;
};

// 섹션 기간·상태, 기간 필터를 통과한 상품, 섹션을 통째로 숨길지.
// 마운트 전(now=0)·미리보기에서는 거르지도 숨기지도 않는다.
export function resolveSection(now: number, input: SectionInput) {
  const { sale, products, sectionPeriods, display, previewState } = input;

  const period = resolveSectionPeriod(now, sale, sectionPeriods ?? products);

  const state = previewState ?? resolveState(now, period.startsAt, period.endsAt);

  const settled = !previewState && now !== 0;

  const shown = (current: SalePreviewState) =>
    current === 'scheduled' ? display.showScheduled : current === 'ended' ? display.showEnded : true;

  const inPeriod = products.filter(
    (p) => !settled || (!p.startsAt && !p.endsAt) || shown(resolveProductState(now, p, sale)),
  );

  const hidden = !settled
    ? false
    : sectionPeriods
      ? !shown(state)
      : !input.paged && products.length > 0 && inPeriod.length === 0;

  return { period, state, products: inPeriod, hidden };
}

// 카드 배지용: 하루 넘게 남으면 「N일」, 안이면 「HH:MM:SS」(라이브와 같다).
export function countdownText(seconds: number) {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}일`;

  return clockText(seconds);
}

const clockText = (seconds: number) =>
  [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

function formatRemaining(seconds: number) {
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds / 60) % 60}분`;
}

// 미리보기 기준 시각: 상태를 바꾼 순간 한 번만 계산해 고정한다
// (틱마다 다시 계산하면 타이머가 줄지 않는다).
export function previewAnchorFor(state: SalePreviewState, now: number): SalePeriod {
  const range = {
    scheduled: [now + 3600000, now + 3600000 + 86400000],
    active: [now - 3600000, now + previewOffsetMs('active')],
    ended: [now - 86400000, now],
  }[state];

  return { startsAt: new Date(range[0]).toISOString(), endsAt: new Date(range[1]).toISOString() };
}

// 고정 기준 시각에서 지금까지 남은 초(예정이면 시작까지, 아니면 종료까지).
export function previewRemainingSeconds(anchor: SalePeriod, state: SalePreviewState, now: number) {
  const target = Date.parse(state === 'scheduled' ? anchor.startsAt : anchor.endsAt);

  return Math.max(0, Math.ceil((target - now) / 1000));
}

function previewOffsetMs(state: SalePreviewState) {
  if (state === 'active') return 86400000 + 123000;
  if (state === 'scheduled') return 3600000;

  return 0;
}

function previewProgress(state: SalePreviewState) {
  if (state === 'active') return 50;
  if (state === 'ended') return 100;

  return 0;
}

// 사용자 변수 값 정하기: 상품이 가진 값 > 변수의 preview 값 순서. 값이 빈 문자열이면 없는 것으로 본다.
export function resolveUserVariables(
  defined: { name: string; preview: string }[],
  ...ownValues: (Record<string, string> | undefined)[]
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const v of defined) {
    const own = ownValues.map((values) => values?.[v.name]).find((value) => typeof value === 'string' && value !== '');
    resolved[v.name] = own ?? v.preview;
  }

  return resolved;
}

// 어드민 미리보기에서 안의 링크(상품·더보기·HTML 속 a)를 눌러도 쇼핑몰로 빠져나가지 않게 막는다.
export function blockPreviewNavigation(event: { target: unknown; preventDefault: () => void }) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;

  if (target?.closest?.('a')) event.preventDefault();
}

// 치환 토큰: 내장 변수([a-z_]+) 또는 사용자 변수(검증기와 같은 이름 문법).
const TOKEN_PATTERN = new RegExp(`\\{\\{(${USER_VARIABLE_NAME_SOURCE}|[a-z_]+)(?:\\^([^}]*))?\\}\\}`, 'g');

// 문구 안의 {{변수}} / {{변수^형식}} 토큰을 값으로 바꾼다(값이 없으면 빈 문자열).
function expand(text: string, values: Record<string, string>) {
  return text.replace(TOKEN_PATTERN, (_, key: string, format?: string) => {
    const value = values[key] ?? '';

    return formatToken(value, format);
  });
}

// 타임세일 섹션 렌더러(스토어프론트·어드민 미리보기
// 공용). 설정의 스타일 레이아웃을 따라 컴포넌트를 그린다.
export function SaleRenderer(props: SaleRendererProps) {
  const [mobile, setMobile] = useState(true),
    [now, setNow] = useState(0),
    [popup, setPopupOpen] = useState(false),
    [tabKey, setTabKey] = useState<string | null>(null);

  // 팝업은 연 버튼을 기억했다가 닫을 때 포커스를 돌려준다. 안에선 Tab 이 뒤쪽 페이지로 새지 않게 가둔다.
  const popupTrigger = useRef<HTMLElement | null>(null);

  const closePopup = () => {
    setPopupOpen(false);
    popupTrigger.current?.focus();
  };

  const trapFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');

    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);

    return () => media.removeEventListener('change', update);
  }, []);

  // 카운트다운용 1초 시계. 서버 렌더와 맞추려고 마운트
  // 뒤에 시작한다(now=0 동안은 필터를 적용하지 않는다).
  useEffect(() => {
    setNow(Date.now());

    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, []);

  const { settings, surface, products, previewState, previewSoldOut, sanitizeHtml } = props;

  const platform = props.platform ?? (mobile ? 'mobile' : 'pc');

  const layout = settings.styles[surface][platform];

  const moreLayout = settings.styles.more[platform];

  // 1) 기간·상태·남은 시간 계산(previewState 가 있으면 어드민 미리보기용 가짜 값)
  const sale = { startsAt: props.startsAt, endsAt: props.endsAt };

  const filtered = previewSoldOut === false ? products.map((p) => ({ ...p, soldOut: false })) : products;

  const section = resolveSection(now, {
    sale,
    products: filtered,
    sectionPeriods: props.sectionPeriods,
    display: { showScheduled: false, showEnded: false },
    previewState,
    paged: Boolean(props.pager),
  });

  const { period, state } = section;

  const countdownTarget = state === 'scheduled' ? period.startsAt : period.endsAt;

  const anchorTarget = props.previewAnchor
    ? Date.parse(state === 'scheduled' ? props.previewAnchor.startsAt : props.previewAnchor.endsAt)
    : 0;

  const end = previewState
    ? props.previewAnchor
      ? now === 0
        ? 0
        : anchorTarget
      : now + previewOffsetMs(state)
    : now === 0
      ? 0
      : Date.parse(countdownTarget);

  const fixedRemaining = (current: SalePreviewState) =>
    now === 0 || !props.previewAnchor ? 0 : previewRemainingSeconds(props.previewAnchor, current, now);

  const remaining =
    previewState && props.previewAnchor ? fixedRemaining(state) : Math.max(0, Math.ceil((end - now) / 1000));

  const productState = (product: SaleProduct) => previewState ?? resolveProductState(now, product, sale);

  const productRemaining = (product: SaleProduct) => {
    if (now === 0 && !previewState) return formatRemaining(0);

    const own = periodOf(product, sale);

    const current = productState(product);

    const target = current === 'scheduled' ? Date.parse(own.startsAt) : Date.parse(own.endsAt);

    const until = previewState ? now + previewOffsetMs(current) : target;

    if (previewState && props.previewAnchor) return formatRemaining(fixedRemaining(current));

    return formatRemaining(Math.max(0, Math.ceil((until - now) / 1000)));
  };

  // 2) 문구에 쓸 변수 모음({{title}}, {{remaining_time}}, 사용자 변수 …)
  const vars: Record<string, string> = {
    ...saleTimeVariables(period, state, remaining),
    title: props.title ?? '타임세일',
    time_sale_name: props.title ?? '타임세일',
    condition: names[state],
    remaining_time: formatRemaining(remaining),
    starts_at: new Date(props.startsAt).toLocaleString('ko-KR'),
    ends_at: new Date(props.endsAt).toLocaleString('ko-KR'),
    ...resolveUserVariables(settings.variables),
  };

  // 3) 노출 여부 판단: 환경/세일 설정에서 꺼져 있거나
  // 기간 기준으로 숨겨야 하면 아무것도 그리지 않는다.
  if (!settings.environment[surface] || section.hidden) return null;

  const tabs = props.tabs ?? [];
  const activeTab = tabs.find((tab) => tab.key === (tabKey ?? props.activeTabKey)) ?? tabs[0];
  const visible =
    activeTab && !activeTab.href
      ? section.products.filter((p) => activeTab.productIds.includes(p.id))
      : section.products;
  vars.product_count = (props.productCount ?? visible.length).toLocaleString('ko-KR');

  const html = (content: string, values = vars) => ({ __html: sanitizeHtml(expand(content, values)) });

  const slot = (l: SaleLayout, position: 'header' | 'footer') => {
    const options = l[`${position}Options`];

    if (!l[position] || options?.enabled === false) return null;

    return (
      <div style={options?.css as CSSProperties}>
        {previewState && props.onPreviewSelect && (
          <button
            type="button"
            className="ts-preview-select"
            aria-label={`${position === 'header' ? '머리말' : '꼬리말'} 편집`}
            aria-pressed={props.previewSelected === position}
            onClick={() => props.onPreviewSelect?.(position)}
          >
            {position === 'header' ? '머리말' : '꼬리말'} / {options?.type === 'image' ? '이미지' : '텍스트'}
          </button>
        )}
        {options?.type === 'image' ? (
          <img
            src={expand(l[position], vars)}
            alt={position === 'header' ? '머리말' : '꼬리말'}
            style={{ display: 'block', maxWidth: '100%', width: '100%' }}
          />
        ) : (
          <div dangerouslySetInnerHTML={html(l[position])} />
        )}
      </div>
    );
  };

  // 4) 레이아웃의 컴포넌트를 현재 상태(state)에 해당하는 것만 순서대로 그린다.
  const drawLayout = (l: SaleLayout, currentSurface: SaleSurface) => (
    <div
      style={
        {
          width: '100%',
          maxWidth: platform === 'mobile' ? '100%' : 1280,
          margin: '0 auto',
          padding: l.css.padding !== undefined ? 0 : platform === 'mobile' ? 16 : 24,
          boxSizing: 'border-box',
          ...l.mainCss,
        } as CSSProperties
      }
      onClickCapture={previewState ? blockPreviewNavigation : undefined}
    >
      {slot(l, 'header')}
      <div
        style={{ boxSizing: 'border-box', ...l.css } as CSSProperties}
        onClickCapture={previewState ? blockPreviewNavigation : undefined}
      >
        {l.components
          .filter((c) => c.states.includes(state))
          .map((c) => (
            <div
              key={c.id}
              data-sale-component={previewState && props.onPreviewSelect ? c.id : undefined}
              style={{ ...c.css, ...c.stateCss?.[state] } as CSSProperties}
              onClickCapture={previewState && props.onPreviewSelect ? () => props.onPreviewSelect?.(c.id) : undefined}
            >
              {previewState && props.onPreviewSelect && (
                <button
                  type="button"
                  className="ts-preview-select"
                  aria-label={`${c.name} 편집`}
                  aria-pressed={props.previewSelected === c.id}
                  onClick={() => props.onPreviewSelect?.(c.id)}
                >
                  타임세일 / {c.name}
                </button>
              )}
              {c.type === 'text' && <div dangerouslySetInnerHTML={html(c.content)} />}
              {c.type === 'image' && c.content && (
                <img
                  src={c.content}
                  alt={c.name}
                  style={{
                    width: `${c.options.imageWidth}%`,
                    maxWidth: '100%',
                    height: 'auto',
                    borderRadius: c.stateCss?.[state]?.borderRadius ?? c.css.borderRadius,
                  }}
                />
              )}
              {/* 더보기 화면이 꺼져 있으면 기본 더보기 버튼은 갈 곳이 없다. 주소 버튼은 그대로 둔다. */}
              {c.type === 'button' &&
                (c.options.buttonAction === 'url' || settings.environment.more) &&
                (c.options.buttonAction !== 'url' &&
                currentSurface === 'main' &&
                settings.environment.moreMode === 'popup' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      popupTrigger.current = e.currentTarget;
                      setPopupOpen(true);
                    }}
                    style={{ ...buttonStyle, ...c.options.buttonCss } as CSSProperties}
                  >
                    {expand(c.content, vars)}
                  </button>
                ) : (
                  <a
                    href={
                      c.options.buttonAction === 'url'
                        ? expand(c.options.href ?? '', vars)
                        : typeof props.moreHref === 'function'
                          ? props.moreHref(platform)
                          : (props.moreHref ?? '/time-sale')
                    }
                    target={c.options.newWindow ? '_blank' : undefined}
                    rel={c.options.newWindow ? 'noopener noreferrer' : undefined}
                    style={{ ...buttonStyle, ...c.options.buttonCss } as CSSProperties}
                  >
                    {expand(c.content, vars)}
                  </a>
                ))}
              {c.type === 'tabs' && tabs.length > 0 && (
                <div
                  role="tablist"
                  style={{ ...tabListStyle, justifyContent: c.css.textAlign === 'left' ? 'flex-start' : 'center' }}
                >
                  {tabs.map((tab) => {
                    const selected = tab.key === activeTab?.key;
                    const style = {
                      ...(c.options.tabCss?.border ? pillTabStyle : tabStyle),
                      ...c.options.tabCss,
                      ...(selected ? c.options.activeTabCss : {}),
                    } as CSSProperties;

                    return tab.href ? (
                      <a key={tab.key} href={tab.href} role="tab" aria-selected={selected} style={style}>
                        {tab.name}
                      </a>
                    ) : (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setTabKey(tab.key)}
                        style={style}
                      >
                        {tab.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {c.type === 'timer' && (
                <Timer component={{ ...c, css: { ...c.css, ...c.stateCss?.[state] } }} end={end} now={now} />
              )}
              {c.type === 'progress' && (
                <>
                  {c.progressTexts ? (
                    c.progressTexts
                      .filter((t) => t.position === 'top')
                      .map((t) => (
                        <div key={t.id} style={t.css as CSSProperties} dangerouslySetInnerHTML={html(t.content)} />
                      ))
                  ) : (
                    <div dangerouslySetInnerHTML={html(c.content || '{{condition}} {{remaining_time^? 남음}}')} />
                  )}
                  <div
                    role="progressbar"
                    aria-label="타임세일 경과"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress)}
                    style={
                      {
                        ...progressTrackStyle(c.options.progressBackground),
                        ...(c.progressTexts?.some((text) => text.position === 'inside') ? { height: 24 } : {}),
                        position: 'relative',
                        ...c.options.progressCss,
                      } as CSSProperties
                    }
                  >
                    <div
                      style={
                        {
                          width: `${progress}%`,
                          height: '100%',
                          background: c.options.progressColor,
                          ...c.options.progressFillCss,
                        } as CSSProperties
                      }
                    />
                    {c.progressTexts
                      ?.filter((t) => t.position === 'inside')
                      .map((t) => (
                        <div
                          key={t.id}
                          style={
                            {
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              ...t.css,
                            } as CSSProperties
                          }
                          dangerouslySetInnerHTML={html(t.content)}
                        />
                      ))}
                  </div>
                  {c.progressTexts
                    ?.filter((t) => t.position === 'bottom')
                    .map((t) => (
                      <div key={t.id} style={t.css as CSSProperties} dangerouslySetInnerHTML={html(t.content)} />
                    ))}
                </>
              )}
              {(c.type === 'carousel' || c.type === 'grid') && (
                <Products
                  component={c}
                  products={visible}
                  vars={vars}
                  html={html}
                  settings={settings}
                  stateOf={productState}
                  pager={props.pager}
                  renderProductActions={props.renderProductActions}
                  renderProductStatus={props.renderProductStatus}
                  productVars={(p) => {
                    const own = periodOf(p, sale);
                    const current = productState(p);
                    const seconds =
                      previewState && props.previewAnchor
                        ? fixedRemaining(current)
                        : Math.max(
                            0,
                            Math.ceil((Date.parse(current === 'scheduled' ? own.startsAt : own.endsAt) - now) / 1000),
                          );

                    return {
                      ...saleTimeVariables(own, current, seconds),
                      product_starts_at: new Date(own.startsAt).toLocaleString('ko-KR'),
                      product_ends_at: new Date(own.endsAt).toLocaleString('ko-KR'),
                      product_remaining: productRemaining(p),
                      // 마운트 전(now=0)엔 비운다 — 서버와 브라우저 시각이 달라 하이드레이션이 어긋난다.
                      product_countdown: now === 0 && !previewState ? '' : countdownText(seconds),
                    };
                  }}
                />
              )}
            </div>
          ))}
      </div>
      {slot(l, 'footer')}
    </div>
  );

  // 진행바: 섹션 기간 중 얼마나 지났는지(%).
  const total = Math.max(1, Date.parse(period.endsAt) - Date.parse(period.startsAt));

  const elapsedPercent = ((now - Date.parse(period.startsAt)) / total) * 100;

  const progress = previewState ? previewProgress(state) : Math.max(0, Math.min(100, elapsedPercent));

  const hasFlip = [layout, moreLayout].some((l) =>
    l.components.some((c) => c.type === 'timer' && c.options.timer === 'flip'),
  );

  return (
    <>
      {hasFlip && <style>{flipCss}</style>}
      {drawLayout(layout, surface)}
      {popup && (
        <div role="presentation" onClick={closePopup} style={popupVeilStyle(settings.environment.veilOpacity)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="타임세일 더보기"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePopup();
              if (e.key === 'Tab') trapFocus(e);
            }}
            style={popupDialogStyle(settings.environment.popupWidth, settings.environment.popupHeight)}
          >
            <button autoFocus type="button" aria-label="닫기" onClick={closePopup} style={popupCloseStyle}>
              ×
            </button>
            {props.renderMorePopup ? props.renderMorePopup() : drawLayout(moreLayout, 'more')}
          </div>
        </div>
      )}
    </>
  );
}

const buttonStyle: CSSProperties = {
  display: 'inline-block',
  border: '1px solid #dddddd',
  padding: '8px 24px',
  borderRadius: 999,
  cursor: 'pointer',
  background: 'white',
  color: 'inherit',
  textDecoration: 'none',
};

const progressTrackStyle = (background: string): CSSProperties => ({
  height: 10,
  borderRadius: 100,
  background,
  overflow: 'hidden',
});

const popupVeilStyle = (veilOpacity: number): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: 10002,
  background: `rgba(0,0,0,${veilOpacity})`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const popupDialogStyle = (width: number, height: number): CSSProperties => ({
  width: `${width}%`,
  maxHeight: `${height}vh`,
  overflow: 'auto',
  padding: '5%',
  background: 'white',
  borderRadius: 4,
});

const popupCloseStyle: CSSProperties = {
  float: 'right',
  position: 'relative',
  zIndex: 1,
  width: 48,
  height: 48,
  border: 0,
  background: 'transparent',
  fontSize: 32,
  lineHeight: 1,
  cursor: 'pointer',
};

const timerStyle: CSSProperties = {
  display: 'grid',
  justifyContent: 'center',
  alignItems: 'center',
  columnGap: 5,
  rowGap: 8,
  fontVariantNumeric: 'tabular-nums',
};

const timerDigitStyle = (flip: boolean): CSSProperties => ({
  display: 'block',
  fontSize: 32,
  minWidth: 44,
  lineHeight: 1.25,
  textAlign: 'center',
  padding: '0 4px',
  border: '1px solid #dddddd',
  borderRadius: 4,
  ...(flip
    ? {
        background: 'linear-gradient(#3b3b3b 50%,#151515 50%)',
        color: '#dddddd',
        boxShadow: 'inset 0 -1px #323232',
      }
    : { background: 'white', color: 'black' }),
});

const timerLabelStyle: CSSProperties = { fontSize: 13, color: '#b7b7b7' };

const productListStyle = (c: SaleComponent, rows = 1): CSSProperties => ({
  display: c.type === 'grid' || c.options.carouselRows ? 'grid' : 'flex',
  gridTemplateColumns: c.type === 'grid' ? `repeat(${c.options.columns},minmax(0,1fr))` : undefined,
  ...(c.type === 'carousel' && c.options.carouselRows
    ? {
        gridAutoFlow: 'column',
        gridTemplateRows: `repeat(${rows},minmax(0,1fr))`,
        gridAutoColumns: `calc((100% - ${c.options.gap * (c.options.columns - 1)}px) / ${c.options.columns})`,
      }
    : {}),
  gap: c.options.gap,
  overflowX: c.type === 'carousel' ? 'auto' : undefined,
  scrollSnapType: 'x mandatory',
});

const defaultEndedCss: SaleCss = { filter: 'grayscale(100%)', opacity: 0.5, pointerEvents: 'none' };

export function productStyle(c: SaleComponent, state: SalePreviewState, soldOut: boolean): SaleCss {
  const stateCss = {
    scheduled: c.options.scheduledCss,
    active: undefined,
    ended: c.options.endedCss ?? defaultEndedCss,
  }[state];

  return {
    ...c.options.productCss,
    ...stateCss,
    ...(soldOut ? c.options.soldOutCss : undefined),
  };
}

const productCardStyle = (c: SaleComponent, state: SalePreviewState, soldOut: boolean): CSSProperties => ({
  color: 'inherit',
  textDecoration: 'none',
  flex: `0 0 calc((100% - ${c.options.gap * (c.options.columns - 1)}px) / ${c.options.columns})`,
  minWidth: 0,
  textAlign: 'left',
  display: 'flex',
  flexDirection: c.options.direction ?? 'column',
  ...(c.options.direction === 'row' ? { flexWrap: 'wrap' } : {}),
  overflowWrap: 'anywhere',
  scrollSnapAlign: 'start',
  ...(productStyle(c, state, soldOut) as CSSProperties),
});

const productImageStyle = (c: SaleComponent, imageSize: number): CSSProperties => ({
  display: 'block',
  width: `${c.options.imageWidth}%`,
  maxWidth: `${imageSize}px`,
  margin: '0',
  aspectRatio: '1',
  objectFit: 'contain',
  borderRadius: c.options.imageRadius,
  ...(c.options.imageCss as CSSProperties),
});

const productImagePlaceholderStyle: CSSProperties = { aspectRatio: '1', background: '#eeeeee' };

const carouselArrowStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: '1px solid #e5e7eb',
  borderRadius: '50%',
  background: 'white',
  color: '#191f28',
  cursor: 'pointer',
  boxShadow: '0 2px 6px #00000014',
};

// 꼭짓점 수와 안쪽 반지름 비율로 별·톱니 모양 clip-path 를 만든다.
function starPolygon(points: number, inner: number) {
  const coords = Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? 50 : 50 * inner;

    const angle = (Math.PI * i) / points - Math.PI / 2;

    return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
  });

  return `polygon(${coords.join(',')})`;
}

// 엠블럼 11종 도형. 키는 어드민 배지 선택값(component.options.badge)과 같고 none 은 배지 없음.
export const BADGE_SHAPES: Record<string, CSSProperties> = {
  flower: { clipPath: starPolygon(12, 0.86) },
  star: { clipPath: starPolygon(16, 0.72) },
  drop: {
    clipPath: 'polygon(50% 0,70% 30%,90% 55%,85% 80%,65% 98%,35% 98%,15% 80%,10% 55%,30% 30%)',
    paddingTop: '20%',
  },
  tag: { clipPath: 'polygon(0 0,85% 0,100% 50%,85% 100%,0 100%)', transform: 'rotate(-45deg)' },
  arrow: { clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)', paddingBottom: '15%' },
  bag: { clipPath: 'url(#ts-badge-bag)', paddingTop: '25%' },
  snowman: { clipPath: 'url(#ts-badge-snowman)', paddingTop: '35%' },
  tree: {
    clipPath: 'polygon(50% 0,90% 55%,65% 55%,100% 90%,58% 90%,58% 100%,42% 100%,42% 90%,0 90%,35% 55%,10% 55%)',
    paddingTop: '30%',
  },
  ornament: { clipPath: 'url(#ts-badge-ornament)', paddingTop: '15%' },
  circle: { borderRadius: '50%' },
  ribbon: { clipPath: 'url(#ts-badge-ribbon)', paddingTop: '20%' },
};

// 곡선이 있는 엠블럼 4종의 윤곽(objectBoundingBox 0~1 좌표). 근거: 엠블럼 패널 증거 이미지.
const badgePaths: Record<string, string> = {
  bag: 'M0.08 0.3 H0.92 L0.98 1 H0.02 Z M0.3 0.3 V0.2 C0.3 -0.07 0.7 -0.07 0.7 0.2 V0.3 H0.6 V0.2 C0.6 0.08 0.4 0.08 0.4 0.2 V0.3 Z',
  snowman:
    'M0.28 0.25 A0.22 0.22 0 1 1 0.72 0.25 A0.22 0.22 0 1 1 0.28 0.25 Z M0.2 0.7 A0.3 0.3 0 1 1 0.8 0.7 A0.3 0.3 0 1 1 0.2 0.7 Z' +
    ' M0.05 0.45 L0.3 0.55 L0.28 0.62 L0.03 0.52 Z M0.95 0.45 L0.7 0.55 L0.72 0.62 L0.97 0.52 Z',
  ornament:
    'M0.12 0.62 A0.38 0.38 0 1 1 0.88 0.62 A0.38 0.38 0 1 1 0.12 0.62 Z M0.4 0.28 H0.6 V0.18 H0.4 Z' +
    ' M0.45 0.18 V0.08 C0.45 0 0.55 0 0.55 0.08 V0.18 Z',
  ribbon:
    'M0.14 0.64 A0.36 0.36 0 1 1 0.86 0.64 A0.36 0.36 0 1 1 0.14 0.64 Z M0.5 0.3 L0.22 0.04 L0.3 0.32 Z M0.5 0.3 L0.78 0.04 L0.7 0.32 Z',
};

// 위 윤곽을 clip-path: url(#...) 로 참조할 수 있게 한 번 깔아 두는 숨은 SVG.
function BadgeDefs({ prefix }: { prefix: string }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {Object.entries(badgePaths).map(([key, d]) => (
          <clipPath key={key} id={`${prefix}-${key}`} clipPathUnits="objectBoundingBox">
            <path d={d} />
          </clipPath>
        ))}
      </defs>
    </svg>
  );
}

// 도형 기본값의 url(#ts-badge-…) 참조를 이 렌더러 전용 접두사로 바꾼다
// (한 페이지에 렌더러가 여럿이어도 id 가 겹치지 않게).
const badgeShape = (badge: string, prefix: string): CSSProperties => {
  const shape = BADGE_SHAPES[badge];

  return shape?.clipPath ? { ...shape, clipPath: String(shape.clipPath).replace('#ts-badge-', `#${prefix}-`) } : shape;
};

const productBadgeStyle = (c: SaleComponent, prefix: string): CSSProperties => ({
  position: 'absolute',
  top: '15%',
  left: '15%',
  display: 'grid',
  placeItems: 'center',
  width: `${c.options.badgeSize * 0.4}%`,
  aspectRatio: '1',
  boxSizing: 'border-box',
  color: 'white',
  background: c.options.badgeColor,
  fontWeight: 'bold',
  fontSize: `${Math.max(10, c.options.badgeSize / 3)}px`,
  zIndex: 99,
  ...badgeShape(c.options.badge, prefix),
  ...(c.options.badgeCss as CSSProperties),
});

// 라이브 상품 카드의 「⏱ 타임세일 · 4일」 배지(이미지 왼쪽 위).
const timeSaleBadgeStyle = (color: string): CSSProperties => ({
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 99,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 4,
  background: color,
  color: '#ffffff',
  fontSize: 11,
  fontWeight: 500,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
});

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

const tabListStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  scrollbarWidth: 'none',
};

const pillTabStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  border: 0,
  backgroundColor: 'transparent',
  font: 'inherit',
  color: 'inherit',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const tabStyle: CSSProperties = { ...pillTabStyle, borderBottom: '2px solid transparent' };

const soldOutOverlayStyle = (c: SaleComponent): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,.6)',
  zIndex: 98,
  ...(c.options.overlayCss as CSSProperties),
});

const pagerStyle: CSSProperties = { display: 'flex', justifyContent: 'center', gap: 4, padding: 8 };

const dotsStyle: CSSProperties = { display: 'flex', justifyContent: 'center', gap: 6, padding: 8 };

const dotStyle = (active: boolean): CSSProperties => ({
  width: 8,
  height: 8,
  padding: 0,
  border: 0,
  borderRadius: '50%',
  background: active ? '#cc3333' : '#dddddd',
});

const pagerButtonStyle = (active: boolean): CSSProperties => ({
  border: '1px solid #ddd',
  borderRadius: 2,
  padding: '4px 8px',
  background: active ? '#cc3333' : 'white',
  color: active ? 'white' : '#787878',
});

const pagerLinkStyle = (active: boolean): CSSProperties => ({
  ...pagerButtonStyle(active),
  minWidth: 28,
  textAlign: 'center',
  textDecoration: 'none',
});

const pagerGapStyle: CSSProperties = { alignSelf: 'center', color: '#787878' };

const flipCss = `
.ts-flip {
  position: relative;
  display: inline-block;
  height: 1.2em;
  line-height: 1.2em;
  perspective: 300px;
}
.ts-flip-size {
  visibility: hidden;
}
.ts-flip-half {
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  overflow: hidden;
  backface-visibility: hidden;
}
.ts-flip-top {
  top: 0;
  transform-origin: bottom;
}
.ts-flip-bottom {
  bottom: 0;
  transform-origin: top;
}
.ts-flip-bottom > span {
  display: block;
  transform: translateY(-50%);
}
.ts-flip-fold-top {
  animation: ts-flip-fold-top 0.3s ease-in forwards;
  background: #3b3b3b;
}
.ts-flip-fold-bottom {
  animation: ts-flip-fold-bottom 0.3s ease-out 0.3s both;
  background: #151515;
}
@keyframes ts-flip-fold-top {
  from {
    transform: rotateX(0deg);
  }
  to {
    transform: rotateX(-90deg);
  }
}
@keyframes ts-flip-fold-bottom {
  from {
    transform: rotateX(90deg);
  }
  to {
    transform: rotateX(0deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ts-flip-fold-top {
    display: none;
  }
  .ts-flip-fold-bottom {
    animation: none;
  }
}
`;

// 숫자가 바뀌면 이전 값 위쪽 반쪽이 접히고 새 값 아래쪽 반쪽이 펴지는 플립 숫자.
function FlipDigit({ value, style }: { value: string; style: CSSProperties }) {
  const previous = useRef(value);

  const from = previous.current;

  useEffect(() => {
    previous.current = value;
  }, [value]);

  const changed = from !== value;

  return (
    <span className="ts-flip" style={style}>
      <span className="ts-flip-size">{value}</span>
      <span className="ts-flip-half ts-flip-top" style={flipHalfStyle}>
        {value}
      </span>
      <span className="ts-flip-half ts-flip-bottom" style={flipHalfStyle}>
        <span>{changed ? from : value}</span>
      </span>
      {changed && (
        <>
          <span key={`top-${value}`} className="ts-flip-half ts-flip-top ts-flip-fold-top" style={flipHalfStyle}>
            {from}
          </span>
          <span
            key={`bottom-${value}`}
            className="ts-flip-half ts-flip-bottom ts-flip-fold-bottom"
            style={flipHalfStyle}
          >
            <span>{value}</span>
          </span>
        </>
      )}
    </span>
  );
}

const flipHalfStyle: CSSProperties = { textAlign: 'center' };

// 끝 시각(ms)과 지금(ms)으로 화면에 보일 [숫자, 단위] 목록을 만든다(옵션에 따라 일 숨김·시간 환산).
export function timerParts(
  end: number,
  now: number,
  options: { daysToHours: boolean; hideZeroDays: boolean },
): [number, string][] {
  const remaining = Math.max(0, Math.ceil((end - now) / 1000));

  const days = Math.floor(remaining / 86400);

  const hours = options.daysToHours ? Math.floor(remaining / 3600) : Math.floor(remaining / 3600) % 24;

  const showDays = !options.daysToHours && (!options.hideZeroDays || days > 0);

  return [
    ...(showDays ? [[days, '일'] as [number, string]] : []),
    [hours, '시간'],
    [Math.floor(remaining / 60) % 60, '분'],
    [remaining % 60, '초'],
  ];
}

// 남은 시간을 일·시간·분·초 칸으로 보여주는 타이머.
function Timer({ component: c, end, now }: { component: SaleComponent; end: number; now: number }) {
  if (c.options.timer === 'text') {
    const remaining = Math.max(0, Math.ceil((end - now) / 1000));
    const days = Math.floor(remaining / 86400);

    // 라이브 섹션 머리의 「종료까지  4일 12:08:16」. 마운트 전엔 자리만 잡는다.
    return (
      <span aria-label="남은 시간" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ lineHeight: 1, ...c.options.timerLabelCss } as CSSProperties}>{c.content}</span>
        <span
          style={
            {
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              visibility: now === 0 ? 'hidden' : undefined,
              ...c.options.timerDigitCss,
            } as CSSProperties
          }
        >
          {days > 0 && `${days}일 `}
          {clockText(remaining)}
        </span>
      </span>
    );
  }

  const flip = c.options.timer === 'flip';

  const parts = timerParts(end, now, c.options);

  const digitStyle = {
    ...timerDigitStyle(flip),
    ...(c.css.fontSize !== undefined ? { fontSize: c.css.fontSize } : {}),
    ...(typeof c.css.color === 'string' ? { color: c.css.color } : {}),
    ...c.options.timerDigitCss,
  };

  return (
    <div aria-label="남은 시간" style={timerStyle}>
      {parts.map(([n, label], i) => (
        <Fragment key={label}>
          {i > 0 && !c.options.timerSeparators?.some(Boolean) && (
            <span
              style={
                { ...c.options.timerSeparatorCss, gridRow: 1, gridColumn: i * 2, alignSelf: 'center' } as CSSProperties
              }
            >
              :
            </span>
          )}
          <div style={{ gridRow: 1, gridColumn: i * 2 + 1 }}>
            {flip ? (
              <FlipDigit value={String(n).padStart(2, '0')} style={digitStyle} />
            ) : (
              <span style={digitStyle}>{String(n).padStart(2, '0')}</span>
            )}
          </div>
          {c.options.showTimerLabels !== false && (
            <span
              style={
                {
                  ...timerLabelStyle,
                  ...c.options.timerLabelCss,
                  gridRow: 2,
                  gridColumn: i * 2 + 1,
                  textAlign: 'center',
                } as CSSProperties
              }
            >
              {c.options.timerLabels?.[['일', '시간', '분', '초'].indexOf(label)] ?? label}
            </span>
          )}
          {!!c.options.timerSeparators?.some(Boolean) && (
            <span
              style={
                {
                  ...c.options.timerSeparatorCss,
                  gridRow: 1,
                  gridColumn: i * 2 + 2,
                  alignSelf: 'center',
                } as CSSProperties
              }
            >
              {c.options.timerSeparators[['일', '시간', '분', '초'].indexOf(label)]}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

// 카드 시작 위치 중 페이지(columns 개씩) 첫 카드의 위치만 고른다.
export function pageStarts(cardOffsets: number[], columns: number) {
  return cardOffsets.filter((_, i) => i % columns === 0);
}

// 현재 스크롤에서 가장 가까운 페이지. 끝까지 갔으면 마지막 페이지.
export function activePageOf(scrollLeft: number, starts: number[], maxScroll: number) {
  if (starts.length === 0) return 0;
  if (scrollLeft >= maxScroll - 2) return starts.length - 1;

  let best = 0;
  starts.forEach((start, i) => {
    if (Math.abs(start - scrollLeft) < Math.abs(starts[best] - scrollLeft)) best = i;
  });

  return best;
}

const startsOf = (el: HTMLElement, columns: number) => {
  const box = el.getBoundingClientRect().left;

  const offsets = Array.from(el.children).map((child) => child.getBoundingClientRect().left - box + el.scrollLeft);

  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);

  return Array.from(new Set(pageStarts(offsets, columns).map((offset) => Math.min(offset, maxScroll))));
};

// 가로 스크롤을 duration(초) 동안 부드럽게 옮긴다. 0 이거나 움직임 줄이기 설정이면 즉시 이동.
// 애니메이션 중에는 스냅을 꺼 두고, 돌려받은 함수로 취소하면 스냅을 복원한다.
function scrollToX(el: HTMLElement, left: number, duration: number) {
  const target = Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth));

  if (duration <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollLeft = target;

    return () => undefined;
  }

  const from = el.scrollLeft;

  const snap = el.style.scrollSnapType;

  const startedAt = performance.now();
  let frame = 0;
  el.style.scrollSnapType = 'none';

  const cancel = () => {
    cancelAnimationFrame(frame);
    el.style.scrollSnapType = snap;
  };

  const step = (time: number) => {
    const t = Math.min(1, (time - startedAt) / (duration * 1000));

    el.scrollLeft = from + (target - from) * (1 - Math.pow(1 - t, 3));
    if (t < 1) frame = requestAnimationFrame(step);
    else cancel();
  };

  frame = requestAnimationFrame(step);

  return cancel;
}

// 상품 캐러셀/그리드. 그리드는 열×행 단위로 페이지를 나누고,
// 캐러셀은 자동 스크롤(호버·포커스·움직임 줄이기 설정이면 멈춤).
function Products({
  component: c,
  products,
  vars,
  html,
  settings,
  stateOf,
  productVars,
  pager,
  renderProductActions,
  renderProductStatus,
}: {
  renderProductActions?: (product: SaleProduct) => ReactNode;
  renderProductStatus?: (product: SaleProduct) => ReactNode;
  pager?: SalePagerItem[];
  component: SaleComponent;
  products: SaleProduct[];
  vars: Record<string, string>;
  html: (content: string, values?: Record<string, string>) => { __html: string };
  settings: TimeSaleSettings;
  stateOf: (product: SaleProduct) => SalePreviewState;
  productVars: (product: SaleProduct) => Record<string, string>;
}) {
  const badgePrefix = `ts-badge-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const [page, setPage] = useState(0);
  const [dot, setDot] = useState(0);

  const scroll = useRef<HTMLDivElement>(null);

  // 랜덤 진열은 마운트 뒤 한 번 정한 씨앗으로만 섞는다. 렌더마다 섞으면 카운트다운(매초)마다 순서가 바뀌고,
  // 서버 렌더에서 섞으면 하이드레이션이 어긋난다. 그래서 첫 그림은 원래 순서다.
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  useEffect(() => {
    if (c.options.productOrder === 'random') setShuffleSeed(Math.floor(Math.random() * 2 ** 31));
  }, [c.options.productOrder]);

  const orderedProducts = useMemo(() => {
    const items = products.slice();

    if (c.options.productOrder === 'reverse') items.reverse();
    if (c.options.productOrder === 'random' && shuffleSeed !== null) {
      const next = seededRandom(shuffleSeed);
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    }

    return c.type === 'carousel' && c.options.slots ? items.slice(0, c.options.slots) : items;
  }, [products, c.options.productOrder, c.options.slots, c.type, shuffleSeed]);

  const stepSize = c.options.slideGroup ?? 1;
  const carouselRows = c.options.carouselRows && orderedProducts.length > c.options.rows ? c.options.rows : 1;
  const carouselColumns = Math.ceil(orderedProducts.length / carouselRows);

  const size = c.options.columns * c.options.rows,
    pages = Math.ceil(orderedProducts.length / size),
    dotCount = orderedProducts.length ? Math.ceil(Math.max(0, carouselColumns - c.options.columns) / stepSize) + 1 : 0;

  const cancelScroll = useRef<() => void>(() => undefined);

  useEffect(() => setPage(0), [products.length, size]);

  // 새 이동을 시작하기 전에 진행 중인 애니메이션을 끊는다.
  const goTo = (el: HTMLElement, left: number) => {
    cancelScroll.current();
    cancelScroll.current = scrollToX(el, left, c.options.duration);
  };

  const goToPage = (el: HTMLElement, index: number) => {
    const starts = startsOf(el, stepSize * carouselRows);

    const last = starts.length - 1;

    goTo(el, starts[Math.max(0, Math.min(index, last))] ?? 0);
  };

  const pageOf = (el: HTMLElement) =>
    activePageOf(el.scrollLeft, startsOf(el, stepSize * carouselRows), el.scrollWidth - el.clientWidth);

  useEffect(() => {
    if (c.type !== 'carousel' || !c.options.autoplay) return;

    const id = setInterval(() => {
      const el = scroll.current;

      if (
        !el ||
        el.matches(':hover') ||
        el.contains(document.activeElement) ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return;

      const current = pageOf(el);

      const lastPage = startsOf(el, stepSize * carouselRows).length - 1;

      if (current >= lastPage) {
        if (c.options.loop) goToPage(el, 0);
      } else goToPage(el, current + 1);
    }, c.options.delay * 1000);

    return () => {
      clearInterval(id);
      cancelScroll.current();
    };
  }, [c.type, c.options.autoplay, c.options.delay, c.options.duration, c.options.loop, stepSize, carouselRows]);

  useEffect(() => () => cancelScroll.current(), []);

  const moveBy = (direction: number) => {
    const el = scroll.current;

    if (el) goToPage(el, pageOf(el) + direction);
  };

  const hasTexts = (c.productTexts ?? []).some((text) => text.position === 'header' || text.position === 'footer');

  // 서버가 이미 한 페이지만 보냈으면(pager) 다시 자르지 않는다.
  const list = c.type === 'grid' && !pager ? orderedProducts.slice(page * size, (page + 1) * size) : orderedProducts;

  const currency = (n: number | null) =>
    n === null
      ? '멤버십 회원에게 가격 공개'
      : `${settings.environment.currencyPrefix}${n.toLocaleString('ko-KR')}${settings.environment.currencySuffix}`;

  return (
    <div style={{ position: 'relative' }}>
      {c.options.badge in badgePaths && <BadgeDefs prefix={badgePrefix} />}
      <div
        ref={scroll}
        style={
          {
            ...productListStyle(c, carouselRows),
            ...(list.length > 0 && list.length < c.options.columns
              ? {
                  justifyContent: 'center',
                  ...(c.type === 'grid'
                    ? {
                        gridTemplateColumns: `repeat(${list.length}, minmax(0, calc((100% - ${c.options.gap * (c.options.columns - 1)}px) / ${c.options.columns})))`,
                      }
                    : {}),
                }
              : {}),
            ...c.options.listCss,
          } as CSSProperties
        }
        onScroll={(e) => {
          const el = e.currentTarget;

          setDot(pageOf(el));
        }}
      >
        {list.map((p) => {
          const discount = p.price !== null && p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;

          const timeSaleBadge = c.options.badge === 'timesale';
          const showBadge = c.options.badge !== 'none' && (timeSaleBadge || discount > 0);
          const Card = c.options.disableProductLink ? 'div' : 'a';
          const image = p.images?.[c.options.imageType ?? 'list'] || p.image;

          const values: Record<string, string> = {
            ...vars,
            ...productVars(p),
            // 상품 값: 호출자가 넘긴 값 > 변수 preview(vars 에 이미 있음)
            ...resolveUserVariables(settings.variables, p.variables),
            product_name: p.name,
            product_no: p.id,
            summary_description: p.summary ?? '',
            model_name: p.modelName ?? '',
            sale_price: currency(p.price),
            time_sale_price: currency(p.price),
            price: currency(p.price),
            original_price: currency(p.originalPrice),
            retail_price: currency(p.originalPrice),
            base_price: currency(p.originalPrice),
            discount_rate: `${discount}%`,
            discount_percent: discount ? `${discount}%` : '',
            discount_amount:
              p.price !== null && p.originalPrice !== null ? currency(Math.max(0, p.originalPrice - p.price)) : '',
            sold_out: p.soldOut ? '품절' : '',
          };

          const texts = (position: 'top' | 'header' | 'footer' | 'bottom', textValues: Record<string, string>) =>
            (c.productTexts ?? [])
              .filter((t) => t.position === position)
              .map((t) => (
                <div
                  key={t.id}
                  style={{
                    ...(c.options.direction === 'row' && position !== 'footer' ? { flex: '0 0 100%' } : {}),
                    ...(position === 'header' || position === 'footer'
                      ? (c.options[`${position}Css`] as CSSProperties)
                      : {}),
                    ...(t.css as CSSProperties),
                  }}
                  dangerouslySetInnerHTML={html(t.content, textValues)}
                />
              ));

          return (
            <Card
              key={p.id}
              className="group"
              href={
                c.options.disableProductLink
                  ? undefined
                  : c.options.productHref
                    ? expand(c.options.productHref, values)
                    : p.href
              }
              target={c.options.newWindow ? '_blank' : undefined}
              rel={c.options.newWindow ? 'noopener noreferrer' : undefined}
              style={productCardStyle(c, stateOf(p), p.soldOut)}
            >
              {texts('top', values)}
              {texts('header', values)}
              <div
                style={{
                  position: 'relative',
                  isolation: 'isolate',
                  width: productImageStyle(c, settings.environment.imageSize).width,
                  maxWidth: productImageStyle(c, settings.environment.imageSize).maxWidth,
                  ...(c.options.direction === 'row' ? { flex: '0 0 45%', minWidth: 0 } : {}),
                }}
              >
                {image ? (
                  <img
                    src={image}
                    alt={p.name}
                    loading="lazy"
                    style={{
                      ...productImageStyle(c, settings.environment.imageSize),
                      width: '100%',
                      maxWidth: '100%',
                    }}
                  />
                ) : (
                  <div style={productImagePlaceholderStyle} />
                )}
                {showBadge &&
                  (timeSaleBadge ? (
                    <span
                      style={{ ...timeSaleBadgeStyle(c.options.badgeColor), ...(c.options.badgeCss as CSSProperties) }}
                    >
                      <ClockIcon />
                      {p.membershipSale ? '멤버십 특가' : '타임세일'}
                      {values.product_countdown && ` · ${values.product_countdown}`}
                    </span>
                  ) : (
                    <span style={productBadgeStyle(c, badgePrefix)}>{discount}%</span>
                  ))}
                {c.imageLayers?.map((layer) => {
                  const content = html(layer.content, values);

                  return content.__html.trim() ? (
                    <div
                      key={layer.id}
                      style={{ position: 'absolute', inset: 0, ...layer.css } as CSSProperties}
                      dangerouslySetInnerHTML={content}
                    />
                  ) : null;
                })}
                {p.soldOut && (
                  <div style={soldOutOverlayStyle(c)} dangerouslySetInnerHTML={html(c.options.overlay, values)} />
                )}
                {renderProductActions && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
                    {renderProductActions(p)}
                  </div>
                )}
              </div>
              <div
                style={{
                  minWidth: 0,
                  ...(c.options.direction === 'row'
                    ? { flex: 1, paddingLeft: c.options.imageContentGap ?? 16 }
                    : { paddingTop: c.options.imageContentGap ?? 0 }),
                }}
              >
                {!hasTexts && (
                  <div
                    style={
                      {
                        fontSize: 14,
                        fontWeight: 600,
                        margin: '16px 0 10px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        ...c.options.headerCss,
                      } as CSSProperties
                    }
                    dangerouslySetInnerHTML={html(c.options.header, values)}
                  />
                )}
                {c.options.showOriginal && discount > 0 && (
                  <div style={{ textDecoration: 'line-through', color: '#8b95a1', fontSize: 13, marginBottom: 2 }}>
                    {currency(p.originalPrice)}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 1 }}>
                  {c.options.showDiscount && discount > 0 && (
                    <strong style={{ color: c.options.badgeColor, ...c.options.discountCss } as CSSProperties}>
                      {discount}%
                    </strong>
                  )}
                  {!hasTexts && (
                    <span
                      style={{ fontSize: 17, fontWeight: 700, ...c.options.footerCss } as CSSProperties}
                      dangerouslySetInnerHTML={html(c.options.footer, values)}
                    />
                  )}
                </div>
                {texts('footer', values)}
                <SaleMembershipPrice
                  price={p.price}
                  membershipPrice={p.membershipPrice}
                  hidden={p.membershipOnly && p.membershipPrice == null}
                  labelOnly={c.options.membershipLabelOnly}
                  membershipSale={p.membershipSale}
                  currency={currency}
                />
                {renderProductStatus && !p.soldOut && <div style={{ marginTop: 8 }}>{renderProductStatus(p)}</div>}
                {!!p.reviewCount && p.reviewCount > 0 && Number.isFinite(p.rating) && (
                  <div
                    aria-label={`평점 ${p.rating}점, 리뷰 ${p.reviewCount.toLocaleString('ko-KR')}개`}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12 }}
                  >
                    <span aria-hidden="true" style={{ position: 'relative', color: '#ddd', letterSpacing: 1 }}>
                      ★★★★★
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${Math.min(5, Math.max(0, p.rating!)) * 20}%`,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          color: '#ffa500',
                        }}
                      >
                        ★★★★★
                      </span>
                    </span>
                    <span style={{ color: '#374151' }}>({p.reviewCount.toLocaleString('ko-KR')})</span>
                  </div>
                )}
              </div>
              {texts('bottom', values)}
            </Card>
          );
        })}
      </div>
      {c.type === 'carousel' && c.options.arrows && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button
            type="button"
            aria-label="이전 상품"
            onClick={() => moveBy(-1)}
            style={{ ...carouselArrowStyle, ...c.options.arrowCss } as CSSProperties}
          >
            〈
          </button>
          <button
            type="button"
            aria-label="다음 상품"
            onClick={() => moveBy(1)}
            style={{ ...carouselArrowStyle, ...c.options.arrowCss } as CSSProperties}
          >
            〉
          </button>
        </div>
      )}
      {c.type === 'carousel' && c.options.dots && dotCount > 0 && (
        <div role="group" aria-label="캐러셀 위치" style={dotsStyle}>
          {Array.from({ length: dotCount }, (_, i) => (
            <button
              type="button"
              key={i}
              aria-label={`${i + 1}번째 위치`}
              aria-current={i === dot ? 'true' : undefined}
              onClick={() => {
                const el = scroll.current;

                if (el) goToPage(el, i);
              }}
              style={
                {
                  ...dotStyle(i === dot),
                  ...(c.options.dotShape === 'square' ? { borderRadius: 0 } : {}),
                  ...(c.options.dotShape === 'number' ? { width: 24, height: 24, fontSize: 12 } : {}),
                  ...c.options.dotCss,
                  ...(i === dot ? c.options.activeDotCss : {}),
                } as CSSProperties
              }
            >
              {c.options.dotShape === 'number' ? i + 1 : null}
            </button>
          ))}
        </div>
      )}
      {pager && products.length === 0 && (
        <p style={{ textAlign: 'center', color: '#787878', padding: 16 }}>이 페이지에 보여줄 상품이 없습니다.</p>
      )}
      {pager && pager.length > 0 && c.options.showPages !== false && (
        <nav aria-label="타임세일 페이지" style={pagerStyle}>
          {pager.map((item, i) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                style={
                  {
                    ...pagerLinkStyle(Boolean(item.current)),
                    ...c.options.pageCss,
                    ...(item.current ? c.options.activePageCss : {}),
                  } as CSSProperties
                }
              >
                {item.label}
              </a>
            ) : (
              <span key={`gap-${i}`} aria-hidden="true" style={pagerGapStyle}>
                {item.label}
              </span>
            ),
          )}
        </nav>
      )}
      {c.type === 'grid' && !pager && pages > 1 && c.options.showPages !== false && (
        <nav aria-label="타임세일 페이지" style={pagerStyle}>
          {pageWindowItems(page + 1, pages, c.options.pageWindow ?? 5).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                type="button"
                key={item}
                aria-current={item === page + 1 ? 'page' : undefined}
                onClick={() => setPage(item - 1)}
                style={
                  {
                    ...pagerButtonStyle(page + 1 === item),
                    ...c.options.pageCss,
                    ...(page + 1 === item ? c.options.activePageCss : {}),
                  } as CSSProperties
                }
              >
                {item}
              </button>
            ),
          )}
        </nav>
      )}
    </div>
  );
}

// 같은 씨앗이면 같은 수열(mulberry32). 랜덤 진열 순서를 렌더 사이에 고정하는 데 쓴다.
function seededRandom(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

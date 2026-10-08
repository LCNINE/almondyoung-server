'use client';

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  USER_VARIABLE_NAME_SOURCE,
  defaultSaleDisplay,
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
  href: string;
  price: number | null;
  originalPrice: number | null;
  soldOut: boolean;
  variables?: Record<string, string>;
  startsAt?: string | null;
  endsAt?: string | null;
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
  saleId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  products: SaleProduct[];
  previewState?: SalePreviewState;
  previewAnchor?: SalePeriod;
  previewSoldOut?: boolean;
  sanitizeHtml: (html: string) => string;
  moreHref?: string;
  // 있으면 그리드는 받은 상품을 한 페이지로 그대로 그리고 링크형 페이지 번호를 둔다.
  // 더보기 서버 페이지네이션용.
  pager?: SalePagerItem[];
  // 섹션 타이머·진행바·노출 판단의 기준 기간들. 없으면 받은 상품으로 계산한다.
  sectionPeriods?: SalePeriodLike[];
};

const names = { scheduled: '할인(예정)', active: '할인(실행중)', ended: '할인(종료)' };

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
    [popup, setPopup] = useState(false);

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
  const d = settings.sales[props.saleId] ?? defaultSaleDisplay();
  const platform = props.platform ?? (mobile ? 'mobile' : 'pc');
  const layout = settings.styles[surface][platform];

  // 1) 기간·상태·남은 시간 계산(previewState 가 있으면 어드민 미리보기용 가짜 값)
  const sale = { startsAt: props.startsAt, endsAt: props.endsAt };
  const filtered = previewSoldOut === false ? products.map((p) => ({ ...p, soldOut: false })) : products;
  const section = resolveSection(now, {
    sale,
    products: filtered,
    sectionPeriods: props.sectionPeriods,
    display: d,
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
    : Date.parse(countdownTarget);
  const fixedRemaining = (current: SalePreviewState) =>
    now === 0 || !props.previewAnchor ? 0 : previewRemainingSeconds(props.previewAnchor, current, now);
  const remaining =
    previewState && props.previewAnchor ? fixedRemaining(state) : Math.max(0, Math.ceil((end - now) / 1000));

  const productState = (product: SaleProduct) => previewState ?? resolveProductState(now, product, sale);
  const productRemaining = (product: SaleProduct) => {
    const own = periodOf(product, sale);
    const current = productState(product);
    const target = current === 'scheduled' ? Date.parse(own.startsAt) : Date.parse(own.endsAt);
    const until = previewState ? now + previewOffsetMs(current) : target;

    if (previewState && props.previewAnchor) return formatRemaining(fixedRemaining(current));

    return formatRemaining(Math.max(0, Math.ceil((until - now) / 1000)));
  };

  // 2) 문구에 쓸 변수 모음({{title}}, {{remaining_time}}, 사용자 변수 …)
  const vars: Record<string, string> = {
    title: props.title,
    condition: names[state],
    remaining_time: formatRemaining(remaining),
    starts_at: new Date(props.startsAt).toLocaleString('ko-KR'),
    ends_at: new Date(props.endsAt).toLocaleString('ko-KR'),
    ...resolveUserVariables(settings.variables),
  };

  // 3) 노출 여부 판단: 환경/세일 설정에서 꺼져 있거나
  // 기간 기준으로 숨겨야 하면 아무것도 그리지 않는다.
  if (!settings.environment.enabled || !settings.environment[surface] || !d[surface]) return null;
  if (section.hidden) return null;

  const visible = d.showSoldOut ? section.products : section.products.filter((p) => !p.soldOut);
  const html = (content: string, values = vars) => ({ __html: sanitizeHtml(expand(content, values)) });

  // 4) 레이아웃의 컴포넌트를 현재 상태(state)에 해당하는 것만 순서대로 그린다.
  const drawLayout = (l: SaleLayout, currentSurface: SaleSurface) => (
    <div style={l.css as CSSProperties} onClickCapture={previewState ? blockPreviewNavigation : undefined}>
      {l.header && <div dangerouslySetInnerHTML={html(l.header)} />}
      {l.components
        .filter((c) => c.states.includes(state))
        .map((c) => (
          <div key={c.id} style={{ ...c.css, ...c.stateCss?.[state] } as CSSProperties}>
            {c.type === 'text' && <div dangerouslySetInnerHTML={html(c.content)} />}
            {c.type === 'image' && c.content && (
              <img src={c.content} alt={c.name} style={{ maxWidth: '100%', height: 'auto' }} />
            )}
            {c.type === 'button' &&
              (currentSurface === 'main' && settings.environment.moreMode === 'popup' ? (
                <button type="button" onClick={() => setPopup(true)} style={buttonStyle}>
                  {expand(c.content, vars)}
                </button>
              ) : (
                <a href={props.moreHref ?? '/time-sale'} style={buttonStyle}>
                  {expand(c.content, vars)}
                </a>
              ))}
            {c.type === 'timer' && <Timer component={c} end={end} now={now} />}
            {c.type === 'progress' && (
              <>
                <div dangerouslySetInnerHTML={html(c.content || '{{condition}} {{remaining_time^? 남음}}')} />
                <div
                  role="progressbar"
                  aria-label="타임세일 경과"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress)}
                  style={progressTrackStyle(c.options.progressBackground)}
                >
                  <div style={{ width: `${progress}%`, height: '100%', background: c.options.progressColor }} />
                </div>
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
                saleProductVariables={d.productVariables}
                pager={props.pager}
                productVars={(p) => ({
                  product_starts_at: new Date(periodOf(p, sale).startsAt).toLocaleString('ko-KR'),
                  product_ends_at: new Date(periodOf(p, sale).endsAt).toLocaleString('ko-KR'),
                  product_remaining: productRemaining(p),
                })}
              />
            )}
          </div>
        ))}
      {l.footer && <div dangerouslySetInnerHTML={html(l.footer)} />}
    </div>
  );

  // 진행바: 섹션 기간 중 얼마나 지났는지(%).
  const total = Math.max(1, Date.parse(period.endsAt) - Date.parse(period.startsAt));
  const elapsedPercent = ((now - Date.parse(period.startsAt)) / total) * 100;
  const progress = previewState ? previewProgress(state) : Math.max(0, Math.min(100, elapsedPercent));

  const hasFlip = [layout, settings.styles.more[platform]].some((l) =>
    l.components.some((c) => c.type === 'timer' && c.options.timer === 'flip'),
  );

  return (
    <>
      {hasFlip && <style>{flipCss}</style>}
      {drawLayout(layout, surface)}
      {popup && (
        <div
          role="presentation"
          onClick={() => setPopup(false)}
          style={popupVeilStyle(settings.environment.veilOpacity)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="타임세일 더보기"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPopup(false);
            }}
            style={popupDialogStyle(settings.environment.popupWidth, settings.environment.popupHeight)}
          >
            <button autoFocus type="button" aria-label="닫기" onClick={() => setPopup(false)} style={popupCloseStyle}>
              ×
            </button>
            {drawLayout(settings.styles.more[platform], 'more')}
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
  borderRadius: 4,
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

const popupCloseStyle: CSSProperties = { float: 'right', width: 40, height: 40 };

const timerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 5,
  fontVariantNumeric: 'tabular-nums',
};

const timerDigitStyle = (flip: boolean): CSSProperties => ({
  display: 'block',
  fontSize: 32,
  minWidth: 44,
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

const productListStyle = (c: SaleComponent): CSSProperties => ({
  display: c.type === 'grid' ? 'grid' : 'flex',
  gridTemplateColumns: `repeat(${c.options.columns},minmax(0,1fr))`,
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
  scrollSnapAlign: 'start',
  ...(productStyle(c, state, soldOut) as CSSProperties),
});

const productImageStyle = (c: SaleComponent, imageSize: number): CSSProperties => ({
  display: 'block',
  width: `${c.options.imageWidth}%`,
  maxWidth: `${imageSize}px`,
  margin: 'auto',
  aspectRatio: '1',
  objectFit: 'contain',
  borderRadius: c.options.imageRadius,
  ...(c.options.imageCss as CSSProperties),
});

const productImagePlaceholderStyle: CSSProperties = { aspectRatio: '1', background: '#eeeeee' };

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
  const flip = c.options.timer === 'flip';
  const parts = timerParts(end, now, c.options);

  return (
    <div aria-label="남은 시간" style={timerStyle}>
      {parts.map(([n, label], i) => (
        <Fragment key={label}>
          {i > 0 && <span>:</span>}
          <div>
            {flip ? (
              <FlipDigit value={String(n).padStart(2, '0')} style={timerDigitStyle(true)} />
            ) : (
              <span style={timerDigitStyle(false)}>{String(n).padStart(2, '0')}</span>
            )}
            <span style={timerLabelStyle}>{label}</span>
          </div>
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

  return pageStarts(offsets, columns);
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
  saleProductVariables,
  pager,
}: {
  pager?: SalePagerItem[];
  component: SaleComponent;
  products: SaleProduct[];
  vars: Record<string, string>;
  html: (content: string, values?: Record<string, string>) => { __html: string };
  settings: TimeSaleSettings;
  stateOf: (product: SaleProduct) => SalePreviewState;
  productVars: (product: SaleProduct) => Record<string, string>;
  saleProductVariables?: Record<string, Record<string, string>>;
}) {
  const badgePrefix = `ts-badge-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [page, setPage] = useState(0);
  const [dot, setDot] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const size = c.options.columns * c.options.rows,
    pages = Math.ceil(products.length / size),
    dotCount = Math.ceil(products.length / c.options.columns);
  const cancelScroll = useRef<() => void>(() => undefined);

  useEffect(() => setPage(0), [products.length, size]);

  // 새 이동을 시작하기 전에 진행 중인 애니메이션을 끊는다.
  const goTo = (el: HTMLElement, left: number) => {
    cancelScroll.current();
    cancelScroll.current = scrollToX(el, left, c.options.duration);
  };

  const goToPage = (el: HTMLElement, index: number) => {
    const starts = startsOf(el, c.options.columns);
    const last = starts.length - 1;

    goTo(el, starts[Math.max(0, Math.min(index, last))] ?? 0);
  };

  const pageOf = (el: HTMLElement) =>
    activePageOf(el.scrollLeft, startsOf(el, c.options.columns), el.scrollWidth - el.clientWidth);

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
      const lastPage = startsOf(el, c.options.columns).length - 1;

      if (current >= lastPage) {
        if (c.options.loop) goToPage(el, 0);
      } else goToPage(el, current + 1);
    }, c.options.delay * 1000);

    return () => {
      clearInterval(id);
      cancelScroll.current();
    };
  }, [c.type, c.options.autoplay, c.options.delay, c.options.duration, c.options.loop, c.options.columns]);

  useEffect(() => () => cancelScroll.current(), []);

  const moveBy = (direction: number) => {
    const el = scroll.current;

    if (el) goToPage(el, pageOf(el) + direction);
  };

  const hasTexts = (c.productTexts ?? []).length > 0;
  // 서버가 이미 한 페이지만 보냈으면(pager) 다시 자르지 않는다.
  const list = c.type === 'grid' && !pager ? products.slice(page * size, (page + 1) * size) : products;
  const currency = (n: number | null) =>
    n === null
      ? '멤버십 회원에게 가격 공개'
      : `${settings.environment.currencyPrefix}${n.toLocaleString('ko-KR')}${settings.environment.currencySuffix}`;

  return (
    <>
      {c.options.badge in badgePaths && <BadgeDefs prefix={badgePrefix} />}
      <div
        ref={scroll}
        style={productListStyle(c)}
        onScroll={(e) => {
          const el = e.currentTarget;

          setDot(pageOf(el));
        }}
      >
        {list.map((p) => {
          const discount = p.price !== null && p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
          const showBadge = c.options.badge !== 'none' && discount > 0;

          const values = {
            ...vars,
            ...productVars(p),
            // 상품 값: 세일 설정에 저장된 상품별 값 > 호출자가 넘긴 값 > 변수 preview(vars 에 이미 있음)
            ...resolveUserVariables(settings.variables, saleProductVariables?.[p.id], p.variables),
            product_name: p.name,
            sale_price: currency(p.price),
            original_price: currency(p.originalPrice),
            discount_rate: `${discount}%`,
            sold_out: p.soldOut ? '품절' : '',
          };

          const texts = (position: 'header' | 'footer', textValues: Record<string, string>) =>
            (c.productTexts ?? [])
              .filter((t) => t.position === position)
              .map((t) => (
                <div
                  key={t.id}
                  style={{ ...(c.options[`${position}Css`] as CSSProperties), ...(t.css as CSSProperties) }}
                  dangerouslySetInnerHTML={html(t.content, textValues)}
                />
              ));

          return (
            <a key={p.id} href={p.href} style={productCardStyle(c, stateOf(p), p.soldOut)}>
              {texts('header', values)}
              <div style={{ position: 'relative' }}>
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.name}
                    loading="lazy"
                    style={productImageStyle(c, settings.environment.imageSize)}
                  />
                ) : (
                  <div style={productImagePlaceholderStyle} />
                )}
                {showBadge && <span style={productBadgeStyle(c, badgePrefix)}>{discount}%</span>}
                {p.soldOut && (
                  <div style={soldOutOverlayStyle(c)} dangerouslySetInnerHTML={html(c.options.overlay, values)} />
                )}
              </div>
              {!hasTexts && (
                <div
                  style={c.options.headerCss as CSSProperties}
                  dangerouslySetInnerHTML={html(c.options.header, values)}
                />
              )}
              {c.options.showOriginal && discount > 0 && (
                <small style={{ textDecoration: 'line-through', color: '#999999' }}>{currency(p.originalPrice)}</small>
              )}
              <div>
                {c.options.showDiscount && discount > 0 && (
                  <strong style={{ color: c.options.badgeColor }}>{discount}% </strong>
                )}
                {!hasTexts && (
                  <span
                    style={c.options.footerCss as CSSProperties}
                    dangerouslySetInnerHTML={html(c.options.footer, values)}
                  />
                )}
              </div>
              {texts('footer', values)}
            </a>
          );
        })}
      </div>
      {c.type === 'carousel' && c.options.arrows && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" aria-label="이전 상품" onClick={() => moveBy(-1)}>
            〈
          </button>
          <button type="button" aria-label="다음 상품" onClick={() => moveBy(1)}>
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
              style={dotStyle(i === dot)}
            />
          ))}
        </div>
      )}
      {pager && products.length === 0 && (
        <p style={{ textAlign: 'center', color: '#787878', padding: 16 }}>이 페이지에 보여줄 상품이 없습니다.</p>
      )}
      {pager && pager.length > 0 && (
        <nav aria-label="타임세일 페이지" style={pagerStyle}>
          {pager.map((item, i) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                style={pagerLinkStyle(Boolean(item.current))}
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
      {c.type === 'grid' && !pager && pages > 1 && (
        <nav aria-label="타임세일 페이지" style={pagerStyle}>
          {Array.from({ length: pages }, (_, i) => (
            <button
              type="button"
              key={i}
              aria-current={i === page ? 'page' : undefined}
              onClick={() => setPage(i)}
              style={pagerButtonStyle(page === i)}
            >
              {i + 1}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

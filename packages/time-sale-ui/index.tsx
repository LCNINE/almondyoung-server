'use client';

import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  defaultSaleDisplay,
  type TimeSaleSettings,
  type SaleSurface,
  type SalePlatform,
  type SalePreviewState,
  type SaleComponent,
  type SaleLayout,
} from '../domain-types/time-sale';

export type SaleProduct = {
  id: string;
  name: string;
  image?: string | null;
  href: string;
  price: number | null;
  originalPrice: number | null;
  soldOut: boolean;
  variables?: Record<string, string>;
};

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
  previewSoldOut?: boolean;
  sanitizeHtml: (html: string) => string;
  moreHref?: string;
};

const names = { scheduled: '할인(예정)', active: '할인(실행중)', ended: '할인(종료)' };

function formatToken(value: string, format?: string) {
  if (!value) return '';
  if (format?.includes('?')) return format.replace('?', value);
  return format ?? value;
}

function resolveState(now: number, startsAt: string, endsAt: string): SalePreviewState {
  if (now < Date.parse(startsAt)) return 'scheduled';
  if (now >= Date.parse(endsAt)) return 'ended';
  return 'active';
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

function expand(text: string, values: Record<string, string>) {
  return text.replace(/\{\{([a-z_]+)(?:\^([^}]*))?\}\}/g, (_, key: string, format?: string) => {
    const value = values[key] ?? '';
    return formatToken(value, format);
  });
}

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

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { settings, surface, products, previewState, previewSoldOut, sanitizeHtml } = props;
  const d = settings.sales[props.saleId] ?? defaultSaleDisplay();
  const platform = props.platform ?? (mobile ? 'mobile' : 'pc');
  const layout = settings.styles[surface][platform];

  const state = previewState ?? resolveState(now, props.startsAt, props.endsAt);
  const countdownTarget = state === 'scheduled' ? props.startsAt : props.endsAt;
  const end = previewState ? now + previewOffsetMs(state) : Date.parse(countdownTarget);
  const remaining = Math.max(0, Math.ceil((end - now) / 1000));

  const vars: Record<string, string> = {
    title: props.title,
    condition: names[state],
    remaining_time: `${Math.floor(remaining / 3600)}시간 ${Math.floor(remaining / 60) % 60}분`,
    starts_at: new Date(props.startsAt).toLocaleString('ko-KR'),
    ends_at: new Date(props.endsAt).toLocaleString('ko-KR'),
    ...Object.fromEntries(
      settings.variables.map((v) => [v.name, previewState ? v.preview : (d.variables[v.name] ?? '')]),
    ),
  };

  if (!settings.environment.enabled || !settings.environment[surface] || !d[surface]) return null;
  const filtered = previewSoldOut === false ? products.map((p) => ({ ...p, soldOut: false })) : products;
  const visible = d.showSoldOut ? filtered : filtered.filter((p) => !p.soldOut);
  const html = (content: string, values = vars) => ({ __html: sanitizeHtml(expand(content, values)) });

  const drawLayout = (l: SaleLayout, currentSurface: SaleSurface) => (
    <div style={l.css as CSSProperties}>
      {l.header && <div dangerouslySetInnerHTML={html(l.header)} />}
      {l.components
        .filter((c) => c.states.includes(state))
        .map((c) => (
          <div key={c.id} style={c.css as CSSProperties}>
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
            {c.type === 'timer' && <Timer component={c} remaining={remaining} />}
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
              <Products component={c} products={visible} vars={vars} html={html} settings={settings} state={state} />
            )}
          </div>
        ))}
      {l.footer && <div dangerouslySetInnerHTML={html(l.footer)} />}
    </div>
  );

  const total = Math.max(1, Date.parse(props.endsAt) - Date.parse(props.startsAt));
  const elapsedPercent = ((now - Date.parse(props.startsAt)) / total) * 100;
  const progress = previewState ? previewProgress(state) : Math.max(0, Math.min(100, elapsedPercent));

  return (
    <>
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

const productCardStyle = (c: SaleComponent, state: SalePreviewState): CSSProperties => ({
  color: 'inherit',
  textDecoration: 'none',
  flex: `0 0 calc((100% - ${c.options.gap * (c.options.columns - 1)}px) / ${c.options.columns})`,
  minWidth: 0,
  scrollSnapAlign: 'start',
  ...(state === 'ended' ? { filter: 'grayscale(1)', opacity: 0.5 } : {}),
});

const productImageStyle = (c: SaleComponent): CSSProperties => ({
  display: 'block',
  width: `${c.options.imageWidth}%`,
  margin: 'auto',
  aspectRatio: '1',
  objectFit: 'contain',
  borderRadius: c.options.imageRadius,
});

const productImagePlaceholderStyle: CSSProperties = { aspectRatio: '1', background: '#eeeeee' };

const productBadgeStyle = (c: SaleComponent): CSSProperties => ({
  position: 'absolute',
  top: '15%',
  left: '15%',
  color: 'white',
  background: c.options.badgeColor,
  padding: '4px',
  borderRadius: c.options.badge === 'tag' ? 4 : '50%',
  fontWeight: 'bold',
  fontSize: `${Math.max(10, c.options.badgeSize / 3)}px`,
  zIndex: 99,
});

const soldOutOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,.6)',
  zIndex: 98,
};

const pagerStyle: CSSProperties = { display: 'flex', justifyContent: 'center', gap: 4, padding: 8 };

const pagerButtonStyle = (active: boolean): CSSProperties => ({
  border: '1px solid #ddd',
  borderRadius: 2,
  padding: '4px 8px',
  background: active ? '#cc3333' : 'white',
  color: active ? 'white' : '#999',
});

function Timer({ component: c, remaining }: { component: SaleComponent; remaining: number }) {
  const days = Math.floor(remaining / 86400),
    hours = c.options.daysToHours ? Math.floor(remaining / 3600) : Math.floor(remaining / 3600) % 24;

  const showDays = !c.options.daysToHours && (!c.options.hideZeroDays || days > 0);
  const parts: [number, string][] = [
    ...(showDays ? [[days, '일'] as [number, string]] : []),
    [hours, '시간'],
    [Math.floor(remaining / 60) % 60, '분'],
    [remaining % 60, '초'],
  ];

  return (
    <div aria-label="남은 시간" style={timerStyle}>
      {parts.map(([n, label], i) => (
        <React.Fragment key={label}>
          {i > 0 && <span>:</span>}
          <div>
            <span style={timerDigitStyle(c.options.timer === 'flip')}>{String(n).padStart(2, '0')}</span>
            <span style={timerLabelStyle}>{label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function Products({
  component: c,
  products,
  vars,
  html,
  settings,
  state,
}: {
  component: SaleComponent;
  products: SaleProduct[];
  vars: Record<string, string>;
  html: (content: string, values?: Record<string, string>) => { __html: string };
  settings: TimeSaleSettings;
  state: SalePreviewState;
}) {
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const size = c.options.columns * c.options.rows,
    pages = Math.ceil(products.length / size);

  useEffect(() => setPage(0), [products.length, size]);

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

      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
        if (c.options.loop) el.scrollTo({ left: 0, behavior: 'smooth' });
      } else el.scrollBy({ left: el.clientWidth / c.options.columns, behavior: 'smooth' });
    }, c.options.delay * 1000);

    return () => clearInterval(id);
  }, [c.type, c.options.autoplay, c.options.delay, c.options.loop, c.options.columns]);

  const list = c.type === 'grid' ? products.slice(page * size, (page + 1) * size) : products;
  const currency = (n: number | null) =>
    n === null
      ? '멤버십 회원 공개'
      : `${settings.environment.currencyPrefix}${n.toLocaleString('ko-KR')}${settings.environment.currencySuffix}`;

  return (
    <>
      <div ref={scroll} style={productListStyle(c)}>
        {list.map((p) => {
          const discount = p.price !== null && p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
          const showBadge = c.options.badge !== 'none' && discount > 0;

          const values = {
            ...vars,
            ...p.variables,
            product_name: p.name,
            sale_price: currency(p.price),
            original_price: currency(p.originalPrice),
            discount_rate: `${discount}%`,
            sold_out: p.soldOut ? '품절' : '',
          };

          return (
            <a key={p.id} href={p.href} style={productCardStyle(c, state)}>
              <div style={{ position: 'relative' }}>
                {p.image ? (
                  <img src={p.image} alt={p.name} loading="lazy" style={productImageStyle(c)} />
                ) : (
                  <div style={productImagePlaceholderStyle} />
                )}
                {showBadge && <span style={productBadgeStyle(c)}>{discount}%</span>}
                {p.soldOut && (
                  <div style={soldOutOverlayStyle} dangerouslySetInnerHTML={html(c.options.overlay, values)} />
                )}
              </div>
              <div dangerouslySetInnerHTML={html(c.options.header, values)} />
              {c.options.showOriginal && discount > 0 && (
                <small style={{ textDecoration: 'line-through', color: '#999999' }}>{currency(p.originalPrice)}</small>
              )}
              <div>
                {c.options.showDiscount && discount > 0 && (
                  <strong style={{ color: c.options.badgeColor }}>{discount}% </strong>
                )}
                <span dangerouslySetInnerHTML={html(c.options.footer, values)} />
              </div>
            </a>
          );
        })}
      </div>
      {c.type === 'carousel' && c.options.arrows && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="이전 상품"
            onClick={() => scroll.current?.scrollBy({ left: -scroll.current.clientWidth, behavior: 'smooth' })}
          >
            〈
          </button>
          <button
            type="button"
            aria-label="다음 상품"
            onClick={() => scroll.current?.scrollBy({ left: scroll.current.clientWidth, behavior: 'smooth' })}
          >
            〉
          </button>
        </div>
      )}
      {c.type === 'grid' && pages > 1 && (
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

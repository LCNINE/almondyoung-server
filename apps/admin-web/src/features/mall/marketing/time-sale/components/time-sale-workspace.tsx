'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import sanitizeHtml from 'sanitize-html';
import { toast } from 'sonner';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import {
  createSaleComponent,
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  type TimeSaleSettings,
  type SaleSurface,
  type SalePlatform,
  type SalePreviewState,
  type SaleCss,
  type SaleComponent,
} from '@packages/domain-types/time-sale';
import {
  SaleRenderer,
  previewAnchorFor,
  type SaleProduct,
} from '@packages/time-sale-ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  createBackGuard,
  navigateTo,
  registerNavigationGuard,
  routeLinkClick,
} from '@/lib/navigation-guard';
import {
  canDeleteSavedStyle,
  deleteSavedStyle,
  linkActiveStyle,
  removeVariableValues,
  saveNewStyle,
  shouldKeepDraftOnRefetch,
} from '../time-sale-model';
import { TimeSaleColorPicker } from './time-sale-color-picker';
import './time-sale-workspace.css';

// 타임세일 화면 공용 토스트(성공/오류).
export const saleToast = (message: string, error = false) =>
  toast[error ? 'error' : 'success'](message, {
    className: error ? 'time-sale-toast-error' : 'time-sale-toast-success',
    position: 'bottom-right',
  });

// 원본 서비스의 초기화 확인 문구.
const RESET_STYLE_TEXT =
  "타임세일 스타일을 초기화 합니다. 안전하게 진행하기 위해 입력란에 '초기화'를 입력하여 주십시오.";

const sections = {
  management: '타임세일 섹션',
  main: '메인 매대 스타일',
  more: '더보기 매대 스타일',
  detail: '상품상세 스타일',
  variables: '사용자 정의 변수',
  environment: '환경설정',
};

const typeLabels = {
  text: '텍스트',
  image: '이미지',
  button: '버튼',
  timer: '타이머',
  progress: '프로그레스',
  carousel: '상품 캐러셀',
  grid: '상품 그리드',
};

const isShelf = (type: string) => type === 'carousel' || type === 'grid';

const optionLabels: Record<keyof SaleComponent['options'], string> = {
  timer: '타이머 형식',
  hideZeroDays: '0일 자동 숨김',
  daysToHours: '일 → 시간 변환',
  columns: '노출 상품 수 / 열 수',
  rows: '페이지 행 수',
  gap: '상품 간격(px)',
  autoplay: '자동 재생',
  delay: '재생 대기(초)',
  duration: '전환 시간(초)',
  loop: '무한 반복',
  arrows: '좌우 화살표',
  dots: '위치 표시',
  badge: '할인율 배지',
  badgeColor: '배지 색상',
  badgeSize: '배지 크기(%)',
  imageWidth: '상품 이미지 폭(%)',
  imageRadius: '이미지 모서리(px)',
  showOriginal: '정가 표시',
  showDiscount: '할인율 표시',
  productCss: '[JSON] 상품 컨테이너 JSX Style',
  soldOutCss: '[JSON] 상품 컨테이너 품절 JSX Style',
  scheduledCss: '[JSON] 상품 컨테이너 예정 JSX Style',
  endedCss: '[JSON] 상품 컨테이너 마감 JSX Style',
  badgeCss: '[JSON] 엠블럼 컨테이너 JSX Style',
  overlayCss: '[JSON] 상품 이미지 레이어 JSX Style',
  imageCss: '[JSON] 상품 이미지 JSX Style',
  headerCss: '[JSON] 상품 머리말 JSX Style',
  footerCss: '[JSON] 상품 꼬리말 JSX Style',
  overlay: '품절 오버레이',
  header: '상품 Header',
  footer: '상품 Footer',
  progressColor: '프로그레스 색상',
  progressBackground: '프로그레스 배경',
};

const sampleProducts: SaleProduct[] = Array.from({ length: 18 }, (_, i) => ({
  id: String(i),
  name: `타임세일 상품 ${i + 1}`,
  image: null,
  href: '#',
  price: 19800 + i * 1000,
  originalPrice: 30000 + i * 1000,
  soldOut: i % 5 === 0,
}));

const cssFields: [keyof SaleCss, string][] = [
  ['color', '글자 색상'],
  ['backgroundColor', '배경 색상'],
  ['fontSize', '글자 크기'],
  ['fontWeight', '글자 굵기'],
  ['textAlign', '정렬'],
  ['padding', '안쪽 여백(위 우 아래 좌)'],
  ['margin', '바깥 여백(위 우 아래 좌)'],
  ['borderTop', '위 테두리'],
  ['borderRight', '우 테두리'],
  ['borderBottom', '아래 테두리'],
  ['borderLeft', '좌 테두리'],
  ['borderRadius', '모서리(좌상 우상 우하 좌하)'],
  ['width', '폭'],
  ['maxWidth', '최대 폭'],
  ['height', '높이'],
  ['opacity', '불투명도'],
];

const cssFieldDefault = (key: keyof SaleCss) => {
  if (key === 'color') return '#000000';
  if (key === 'backgroundColor') return '#ffffff';
  return '';
};

const saveMessage = (section: string, selected: string) => {
  if (section === 'environment') return '환경설정 변경 사항을 저장하였습니다.';
  if (selected === 'header') return 'Header 스타일 변경 사항을 저장하였습니다.';
  if (selected === 'footer') return 'Footer 스타일 변경 사항을 저장하였습니다.';
  if (selected === 'container') {
    return '컨테이너 스타일 변경 사항을 저장하였습니다.';
  }
  return undefined;
};

const slotButtonLabels = {
  header: 'Header',
  container: '매대 컨테이너',
  footer: 'Footer',
};

const selectionLabel = (selected: string, componentName?: string) => {
  if (selected === 'container') return '컨테이너';
  if (selected === 'header') return 'Header';
  if (selected === 'footer') return 'Footer';
  return componentName;
};

const TIMER_OPTION_KEYS = ['timer', 'hideZeroDays', 'daysToHours'];

const PROGRESS_OPTION_KEYS = ['progressColor', 'progressBackground'];

const CSS_OPTION_KEYS = [
  'productCss',
  'soldOutCss',
  'scheduledCss',
  'endedCss',
  'badgeCss',
  'overlayCss',
  'imageCss',
  'headerCss',
  'footerCss',
] as const;

// 상품 메시지 텍스트 최대 개수. 서버 검증(domain-types)의 상한과 같은 값이다.
const MAX_PRODUCT_TEXTS = 7;

const stateTabLabels: Record<SalePreviewState, string> = {
  scheduled: '예정',
  active: '할인',
  ended: '마감',
};

// 컴포넌트 종류별로 편집 화면에 보여줄 옵션 키를
// 거른다(타이머·진행바·상품 목록이 각자 쓰는 옵션만).
const optionAppliesTo = (type: SaleComponent['type'], key: string) => {
  if ((CSS_OPTION_KEYS as readonly string[]).includes(key)) return false;
  if (type === 'timer') return TIMER_OPTION_KEYS.includes(key);
  if (type === 'progress') return PROGRESS_OPTION_KEYS.includes(key);
  if (type === 'carousel' || type === 'grid') {
    return ![...TIMER_OPTION_KEYS, ...PROGRESS_OPTION_KEYS].includes(key);
  }
  return false;
};

const optionInputType = (key: string, value: unknown) => {
  if (typeof value === 'number') return 'number';
  if (key.toLowerCase().includes('color') || key === 'progressBackground') {
    return 'color';
  }
  return 'text';
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ts-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CssEditor({
  value,
  onChange,
}: {
  value: SaleCss;
  onChange: (css: SaleCss) => void;
}) {
  const [json, setJson] = useState('');

  return (
    <>
      <details open>
        <summary>컨테이너 / 텍스트 스타일</summary>
        {cssFields.map(([key, label]) => (
          <Field key={key} label={label}>
            {key === 'color' || key === 'backgroundColor' ? (
              <TimeSaleColorPicker
                value={String(value[key] ?? cssFieldDefault(key))}
                onChange={(color) => onChange({ ...value, [key]: color })}
              />
            ) : (
              <input
                type="text"
                value={value[key] ?? cssFieldDefault(key)}
                onChange={(e) => {
                  const next = { ...value };
                  if (e.target.value) next[key] = e.target.value;
                  else delete next[key];
                  onChange(next);
                }}
              />
            )}
          </Field>
        ))}
      </details>
      <details>
        <summary>사용자 정의 CSS JSON</summary>
        <textarea
          aria-label="사용자 정의 CSS JSON"
          value={json}
          placeholder={JSON.stringify(value, null, 2)}
          onChange={(e) => setJson(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            try {
              const parsed: unknown = JSON.parse(json);
              if (
                !parsed ||
                typeof parsed !== 'object' ||
                Array.isArray(parsed)
              )
                throw new Error();
              const settings = defaultTimeSaleSettings();
              settings.styles.main.mobile.css = parsed as SaleCss;
              validateTimeSaleSettings(settings);
              onChange(parsed as SaleCss);
              saleToast('적용을 완료하였습니다.');
            } catch {
              saleToast('허용된 스타일 속성과 올바른 JSON을 입력하세요.', true);
            }
          }}
        >
          적용
        </button>
      </details>
    </>
  );
}

type ProductText = NonNullable<SaleComponent['productTexts']>[number];

function StateCssEditor({
  component,
  onChange,
}: {
  component: SaleComponent;
  onChange: (state: SalePreviewState, css: SaleCss) => void;
}) {
  const [tab, setTab] = useState<SalePreviewState>('scheduled');

  return (
    <details>
      <summary>상태별 컴포넌트 CSS</summary>
      <div className="ts-inline">
        {(Object.keys(stateTabLabels) as SalePreviewState[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={tab === v}
            onClick={() => setTab(v)}
          >
            {stateTabLabels[v]}
          </button>
        ))}
      </div>
      <CssEditor
        key={`${component.id}-${tab}`}
        value={component.stateCss?.[tab] ?? {}}
        onChange={(css) => onChange(tab, css)}
      />
    </details>
  );
}

function ProductTextsEditor({
  component,
  onChange,
}: {
  component: SaleComponent;
  onChange: (texts: ProductText[]) => void;
}) {
  const texts = component.productTexts ?? [];

  const update = (index: number, patch: Partial<ProductText>) =>
    onChange(texts.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const move = (index: number, delta: number) => {
    const next = [...texts];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);

    onChange(next);
  };

  return (
    <details>
      <summary>상품 메시지 텍스트</summary>
      <button
        type="button"
        disabled={texts.length >= MAX_PRODUCT_TEXTS}
        onClick={() =>
          onChange([
            ...texts,
            {
              id: `text-${Date.now()}`,
              position: 'footer',
              content: '{{product_name}}',
              css: {},
            },
          ])
        }
      >
        메시지 텍스트 추가
      </button>
      {texts.map((t, i) => (
        <div key={t.id}>
          <strong>
            {i + 1} / {MAX_PRODUCT_TEXTS}
          </strong>
          <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
            위로
          </button>
          <button
            type="button"
            disabled={i === texts.length - 1}
            onClick={() => move(i, 1)}
          >
            아래로
          </button>
          <button
            type="button"
            onClick={() => onChange(texts.filter((_, j) => j !== i))}
          >
            삭제
          </button>
          <Field label="위치">
            <select
              value={t.position}
              onChange={(e) =>
                update(i, {
                  position: e.target.value as ProductText['position'],
                })
              }
            >
              <option value="header">머리말</option>
              <option value="footer">꼬리말</option>
            </select>
          </Field>
          <Field label="메시지 형식">
            <textarea
              value={t.content}
              onChange={(e) => update(i, { content: e.target.value })}
            />
          </Field>
          <CssEditor
            key={t.id}
            value={t.css}
            onChange={(css) => update(i, { css })}
          />
        </div>
      ))}
    </details>
  );
}

// 타임세일 관리 화면의 공통 틀: 설정을 불러와 편집(update)·저장(save)하고
// 섹션(매대 스타일·환경설정)을 전환한다. 목록·등록 화면도 이 안에 들어간다.
export function TimeSaleWorkspace({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['time-sale-settings'],
    queryFn: medusaTimeSaleSettingsApi.get,
  });

  const [settings, setSettings] = useState<TimeSaleSettings | null>(null),
    [revision, setRevision] = useState(''),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);

  const [section, setSection] = useState<keyof typeof sections>('management'),
    [platform, setPlatform] = useState<SalePlatform>('mobile'),
    [state, setState] = useState<SalePreviewState>('active'),
    [soldOut, setSoldOut] = useState(true),
    [selected, setSelected] = useState('container'),
    [refresh, setRefresh] = useState(0),
    [previewAnchor, setPreviewAnchor] = useState(() =>
      previewAnchorFor('active', Date.now())
    ),
    [width, setWidth] = useState(375);

  const [confirmation, setConfirmation] = useState<{
      text: string;
      run: () => void;
      reset?: boolean;
      title?: string;
    } | null>(null),
    [resetText, setResetText] = useState('');

  const [variableName, setVariableName] = useState(''),
    [variableDescription, setVariableDescription] = useState(''),
    [variablePreview, setVariablePreview] = useState(''),
    [editingVariable, setEditingVariable] = useState<string | null>(null);

  // 서버 설정을 편집본으로 복사한다. 편집 중(dirty)이거나 이미 같은 revision 이면 덮어쓰지 않는다.
  useEffect(() => {
    if (!query.data) return;
    if (
      shouldKeepDraftOnRefetch(dirty, query.data.revision, revision) &&
      settings
    )
      return;

    setSettings(structuredClone(query.data.settings));
    setRevision(query.data.revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, dirty]);

  // 저장하지 않은 변경을 버리고 서버 설정으로 되돌린다(이동 확인 후).
  const discardDraft = () => {
    // 센티넬 정리는 dirty 효과(backGuard.sync)가 한 길로 맡는다. 라우트 이동이면 그 전에 release 된다.
    if (query.data) {
      setSettings(structuredClone(query.data.settings));
      setRevision(query.data.revision);
    }
    setDirty(false);
  };

  // dirty 면 확인창을 거쳐 편집본을 버리고 이동하고, 아니면 바로 이동한다.
  const guarded = (go: () => void) => {
    if (!dirty) return go();

    ask({
      title: '확인',
      text: '수정 사항이 존재합니다. 무시하고 탭을 이동하시겠습니까?',
      run: () => {
        discardDraft();
        go();
      },
    });
  };

  // 라우트 이동 승인: 센티넬은 navigateTo 가 replace 로 덮으므로 back 으로 지우지 않게 풀어 둔다.
  const guardedLeave = (go: () => void) =>
    guarded(() => {
      backGuard.current?.release();
      go();
    });

  const backGuard = useRef<ReturnType<typeof createBackGuard> | null>(null);

  // 확인창 직전 포커스를 기억했다가 닫을 때 돌려준다(트리거 없는 제어형 다이얼로그라 직접 처리).
  const returnFocus = useRef<HTMLElement | null>(null);

  function ask(next: NonNullable<typeof confirmation>) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setConfirmation(next);
  }

  // Next 앱 라우터에는 routeChangeStart 가 없다. dirty 동안 두 길을 막는다(뒤로가기는 아래 createBackGuard):
  // 1) 링크 클릭(캡처, 미리보기 제외) 2) 사이드바 router.push(navigation-guard)
  const router = useRouter();
  const guardedRef = useRef(guardedLeave);
  guardedRef.current = guardedLeave;

  useEffect(() => {
    if (!dirty) return;

    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (e.defaultPrevented || e.button !== 0) return;

      const url = new URL(anchor.href, window.location.href);
      const action = routeLinkClick({
        insidePreview: !!anchor.closest('.ts-preview'),
        dirty: true,
        sameOrigin: url.origin === window.location.origin,
        samePage:
          url.pathname === window.location.pathname &&
          url.search === window.location.search,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        newTab: !!anchor.target && anchor.target !== '_self',
      });

      if (action === 'pass') return;

      e.preventDefault();
      if (action === 'block') return;

      e.stopPropagation();
      guardedRef.current(() =>
        navigateTo(router, url.pathname + url.search + url.hash)
      );
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, router]);

  // 사이드바처럼 router.push 를 직접 부르는 곳이 확인을 거치도록 가드를 등록한다.
  useEffect(() => {
    if (!dirty) return;

    return registerNavigationGuard((go) => guardedRef.current(go));
  }, [dirty]);

  // 뒤로가기 경고(navigation-guard 의 createBackGuard): popstate 에 네이티브 confirm.
  // 확인 후 못 떠나면(직접 진입) 목록으로 replace 한다. 언마운트 때는 history 를 건드리지 않는다.
  const discardRef = useRef(discardDraft);
  discardRef.current = discardDraft;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const g = createBackGuard({
      history: window.history,
      href: () => window.location.href,
      confirm: (message) => window.confirm(message),
      discard: () => discardRef.current(),
      fallback: () => routerRef.current.replace('/mall/marketing/time-sale'),
      setTimer: (run, ms) => {
        const id = window.setTimeout(run, ms);
        return () => window.clearTimeout(id);
      },
    });
    backGuard.current = g;

    const onPopState = () => g.onPopState();
    // 다른 문서로 떠나는 신호(pagehide·beforeunload)도 폴백 취소로 본다.
    const onLeave = () => g.left();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
      g.dispose();
      backGuard.current = null;
    };
  }, []);

  // dirty 켜짐: 센티넬 쌓기. 꺼짐(저장·전환 버림·확인 버림): 센티넬이 맨 위면 지운다.
  useEffect(() => {
    backGuard.current?.sync(dirty);
  }, [dirty]);

  // 저장하지 않은 변경이 있으면 탭을 닫을 때 경고한다.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // 설정 편집본을 복제해 고친 뒤 dirty 로 표시한다(원본 불변).
  const update = (run: (s: TimeSaleSettings) => void) => {
    if (!settings) return;
    const next = structuredClone(settings);
    run(next);
    setSettings(next);
    setDirty(true);
  };

  // 저장: 클라이언트에서 먼저 검증하고, 서버에는 불러올 때의
  // revision 을 같이 보낸다(다른 관리자가 먼저 바꿨으면 거절).
  const save = async (
    message = '타임세일 스타일 변경 사항을 저장하였습니다.'
  ) => {
    if (!settings) return;

    try {
      // 활성 레이아웃이 라이브러리 스타일과 이어져 있으면 그 항목도 같이 갱신한다.
      const toSave = structuredClone(settings);
      if (section === 'main' || section === 'more' || section === 'detail')
        linkActiveStyle(toSave, section, platform);

      validateTimeSaleSettings(toSave);

      setSaving(true);
      const result = await medusaTimeSaleSettingsApi.save(toSave, revision);

      setRevision(result.revision);
      setSettings(result.settings);
      setDirty(false);
      // 오래된 캐시가 방금 저장한 편집본을 덮지 않게 캐시도 같이 맞춘다.
      queryClient.setQueryData(['time-sale-settings'], {
        settings: result.settings,
        revision: result.revision,
      });

      await queryClient.invalidateQueries({ queryKey: ['time-sale-settings'] });
      saleToast(message);
    } catch (e) {
      saleToast(
        e instanceof Error ? e.message : '설정을 저장하지 못했습니다.',
        true
      );
    } finally {
      setSaving(false);
    }
  };

  const surface: SaleSurface =
    section === 'more' || section === 'detail' ? section : 'main';

  const layout = settings?.styles[surface][platform];
  const component = layout?.components.find((c) => c.id === selected);
  const hasShelf = !!layout?.components.some((c) => isShelf(c.type));

  const changeLayout = (run: (l: NonNullable<typeof layout>) => void) =>
    update((s) => run(s.styles[surface][platform]));

  const changeComponent = (run: (c: SaleComponent) => void) =>
    changeLayout((l) => {
      const c = l.components.find((c) => c.id === selected);
      if (c) run(c);
    });

  const switchSection = (next: keyof typeof sections) => {
    if (next === section) return;

    guarded(() => {
      setSection(next);
      setSelected('container');
    });
  };

  // 컴포넌트 종류 변경. 상품 캐러셀/그리드는 한 레이아웃에 하나만 허용한다.
  const changeType = (type: SaleComponent['type']) => {
    if (!component) return;
    if (
      (type === 'grid' || type === 'carousel') &&
      layout?.components.some(
        (c) => c.id !== selected && (c.type === 'grid' || c.type === 'carousel')
      )
    ) {
      saleToast('상품 캐러셀/그리드는 하나만 추가할 수 있습니다.', true);
      return;
    }
    changeComponent((c) => Object.assign(c, createSaleComponent(type, c.id)));
  };

  return (
    <div className="ts-workspace">
      <aside className="ts-navigation">
        {Object.entries(sections).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={section === key ? 'active' : ''}
            onClick={() => switchSection(key as keyof typeof sections)}
          >
            {label}
          </button>
        ))}
      </aside>
      <div className="ts-body">
        <header className="ts-appbar">
          <strong>타임세일 · {sections[section]}</strong>
          {section !== 'management' && (
            <>
              <span>{dirty ? '저장되지 않은 변경 사항' : '저장됨'}</span>
              <button
                disabled={saving || !settings || query.isError}
                onClick={() => void save(saveMessage(section, selected))}
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </>
          )}
        </header>
        {query.isError && section !== 'management' ? (
          <div role="alert" className="ts-empty">
            설정을 불러오지 못했습니다.{' '}
            <button onClick={() => void query.refetch()}>다시 시도</button>
          </div>
        ) : section === 'management' ? (
          children
        ) : !settings ? (
          <div className="ts-empty">불러오는 중…</div>
        ) : section === 'environment' ? (
          <div className="ts-settings">
            <h2>환경설정</h2>
            {(
              [
                'enabled',
                'membershipPriceOnly',
                'main',
                'more',
                'detail',
              ] as const
            ).map((key) => (
              <Field
                key={key}
                label={
                  {
                    enabled: '타임세일 서비스',
                    membershipPriceOnly: '가격 공개 제한 (모든 세일)',
                    main: '메인 매대 노출',
                    more: '더보기 매대 노출',
                    detail: '상품상세 노출',
                  }[key]
                }
              >
                <input
                  type="checkbox"
                  checked={settings.environment[key]}
                  onChange={(e) =>
                    update((s) => {
                      s.environment[key] = e.target.checked;
                    })
                  }
                />
              </Field>
            ))}
            <Field label="할인 금액 반올림">
              <select
                value={settings.environment.rounding}
                onChange={(e) =>
                  update((s) => {
                    s.environment.rounding = e.target.value as
                      | 'round'
                      | 'ceil'
                      | 'floor';
                  })
                }
              >
                <option value="round">반올림</option>
                <option value="ceil">올림</option>
                <option value="floor">내림</option>
              </select>
            </Field>
            <Field label="상품 이미지 크기(1~1500px)">
              <input
                type="number"
                min={1}
                max={1500}
                value={settings.environment.imageSize}
                onChange={(e) =>
                  update((s) => {
                    s.environment.imageSize = Number(e.target.value);
                  })
                }
              />
            </Field>
            {(['currencyPrefix', 'currencySuffix'] as const).map((key) => (
              <Field
                key={key}
                label={key === 'currencyPrefix' ? '통화 접두어' : '통화 접미어'}
              >
                <input
                  maxLength={20}
                  value={settings.environment[key]}
                  onChange={(e) =>
                    update((s) => {
                      s.environment[key] = e.target.value;
                    })
                  }
                />
              </Field>
            ))}
            <Field label="더보기 방식">
              <select
                value={settings.environment.moreMode}
                onChange={(e) =>
                  update((s) => {
                    s.environment.moreMode = e.target.value as 'page' | 'popup';
                  })
                }
              >
                <option value="page">전용 페이지</option>
                <option value="popup">팝업</option>
              </select>
            </Field>
            {(['popupWidth', 'popupHeight', 'veilOpacity'] as const).map(
              (key) => (
                <Field
                  key={key}
                  label={
                    {
                      popupWidth: '팝업 폭(%)',
                      popupHeight: '팝업 최대 높이(%)',
                      veilOpacity: '배경 불투명도(0~1)',
                    }[key]
                  }
                >
                  <input
                    type="number"
                    step={key === 'veilOpacity' ? 0.1 : 1}
                    value={settings.environment[key]}
                    onChange={(e) =>
                      update((s) => {
                        s.environment[key] = Number(e.target.value);
                      })
                    }
                  />
                </Field>
              )
            )}
          </div>
        ) : section === 'variables' ? (
          <div className="ts-settings">
            <h2>사용자 정의 변수 ({settings.variables.length}/5)</h2>
            <p>
              텍스트에 {'{{user_변수명}}'}을 입력하세요. 상품별 값은 타임세일
              편집에서 지정합니다.
            </p>
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>설명</th>
                  <th>프리뷰 값</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.variables.map((v) => (
                  <tr key={v.name}>
                    <td>{v.name}</td>
                    <td>{v.description}</td>
                    <td>{v.preview}</td>
                    <td>
                      <button
                        onClick={() => {
                          setEditingVariable(v.name);
                          setVariableName(v.name.slice(5));
                          setVariableDescription(v.description);
                          setVariablePreview(v.preview);
                        }}
                      >
                        수정
                      </button>
                      <button
                        onClick={() =>
                          ask({
                            text: `${v.name} 변수를 삭제하시겠습니까?`,
                            run: () =>
                              update((s) => {
                                s.variables = s.variables.filter(
                                  (x) => x.name !== v.name
                                );
                                removeVariableValues(s.sales, v.name);
                              }),
                          })
                        }
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Field label="이름 (user_ 자동 추가)">
              <input
                disabled={!!editingVariable}
                maxLength={30}
                value={variableName}
                onChange={(e) => setVariableName(e.target.value)}
              />
            </Field>
            <Field label="설명">
              <input
                maxLength={30}
                value={variableDescription}
                onChange={(e) => setVariableDescription(e.target.value)}
              />
            </Field>
            <Field label="프리뷰 값">
              <input
                maxLength={256}
                value={variablePreview}
                onChange={(e) => setVariablePreview(e.target.value)}
              />
            </Field>
            <button
              onClick={() => {
                const name = editingVariable ?? `user_${variableName}`;

                if (
                  !/^user_[a-z][a-z0-9_]{0,29}$/.test(name) ||
                  (!editingVariable &&
                    (settings.variables.length >= 5 ||
                      settings.variables.some((v) => v.name === name)))
                ) {
                  saleToast('변수 이름과 개수(최대 5개)를 확인하세요.', true);
                  return;
                }

                update((s) => {
                  const v = {
                    name,
                    description: variableDescription,
                    preview: variablePreview,
                  };
                  if (editingVariable)
                    s.variables = s.variables.map((x) =>
                      x.name === name ? v : x
                    );
                  else s.variables.push(v);
                });

                saleToast(
                  editingVariable
                    ? '사용자 정의 변수를 수정 하였습니다.'
                    : '신규 사용자 정의 변수를 추가 하였습니다.'
                );

                setEditingVariable(null);
                setVariableName('');
                setVariableDescription('');
                setVariablePreview('');
              }}
            >
              {' '}
              {editingVariable ? '수정' : '추가'}
            </button>
            <button
              onClick={() => {
                setEditingVariable(null);
                setVariableName('');
              }}
            >
              취소
            </button>
          </div>
        ) : (
          layout && (
            <>
              <div className="ts-toolbar">
                <select
                  aria-label="프리뷰 상태"
                  value={state}
                  onChange={(e) => {
                    const next = e.target.value as SalePreviewState;

                    setState(next);
                    setPreviewAnchor(previewAnchorFor(next, Date.now()));
                  }}
                >
                  <option value="scheduled">할인(예정)</option>
                  <option value="active">할인(실행중)</option>
                  <option value="ended">할인(종료)</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={soldOut}
                    onChange={(e) => setSoldOut(e.target.checked)}
                  />{' '}
                  품절모드
                </label>
                {(['mobile', 'pc'] as const).map((p) => (
                  <label key={p}>
                    <input
                      type="radio"
                      name="ts-platform"
                      checked={p === platform}
                      onChange={() =>
                        guarded(() => {
                          setPlatform(p);
                          setWidth(p === 'mobile' ? 375 : 1000);
                          setSelected('container');
                        })
                      }
                    />{' '}
                    {p === 'mobile' ? '모바일' : 'PC'}
                  </label>
                ))}
                <button
                  aria-label="프리뷰 새로고침"
                  onClick={() => {
                    setPreviewAnchor(previewAnchorFor(state, Date.now()));
                    setRefresh((v) => v + 1);
                  }}
                >
                  ↻
                </button>
                <label>
                  프리뷰 폭{' '}
                  <input
                    type="number"
                    min={280}
                    max={1600}
                    value={width}
                    onChange={(e) =>
                      setWidth(
                        Math.min(1600, Math.max(280, Number(e.target.value)))
                      )
                    }
                  />
                </label>
              </div>
              <div className="ts-editor">
                <div className="ts-components">
                  <Field label="스타일 이름">
                    <input
                      value={layout.name}
                      onChange={(e) =>
                        changeLayout((l) => {
                          l.name = e.target.value;
                        })
                      }
                      maxLength={100}
                    />
                  </Field>
                  <div className="ts-actions">
                    <button
                      onClick={() => {
                        if (settings.savedStyles.length >= 50) {
                          saleToast('스타일은 최대 50개입니다.', true);
                          return;
                        }

                        // 활성 레이아웃을 새 스타일로 저장하고 그 id 로 이어 붙인다.
                        update((s) =>
                          saveNewStyle(
                            s,
                            surface,
                            platform,
                            `style-${Date.now()}`
                          )
                        );
                        saleToast('신규 스타일을 생성하였습니다.');
                      }}
                    >
                      신규 스타일
                    </button>
                    <select
                      aria-label="스타일 가져오기"
                      value=""
                      onChange={(e) => {
                        const imported = settings.savedStyles.find(
                          (s) => s.id === e.target.value
                        );
                        if (imported)
                          ask({
                            text: '현재 스타일을 선택한 스타일로 덮어쓰시겠습니까?',
                            run: () => {
                              changeLayout((l) =>
                                Object.assign(l, structuredClone(imported))
                              );
                              setSelected('container');
                              saleToast('스타일을 가져왔습니다.');
                            },
                          });
                      }}
                    >
                      <option value="">스타일 가져오기</option>
                      {settings.savedStyles.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        ask({
                          text: RESET_STYLE_TEXT,
                          reset: true,
                          run: () => {
                            changeLayout((l) =>
                              Object.assign(
                                l,
                                defaultTimeSaleSettings().styles[surface][
                                  platform
                                ]
                              )
                            );
                            setSelected('container');
                          },
                        })
                      }
                    >
                      초기화
                    </button>
                    <button
                      disabled={
                        !canDeleteSavedStyle(settings, surface, platform)
                      }
                      onClick={() =>
                        ask({
                          text: `[${layout.name}] 매대 스타일을 삭제 하시겠습니까?`,
                          run: () =>
                            update((s) =>
                              deleteSavedStyle(s, surface, platform)
                            ),
                        })
                      }
                    >
                      스타일 삭제
                    </button>
                  </div>
                  {(['header', 'container', 'footer'] as const).map((key) => (
                    <button
                      className={`ts-component ${selected === key ? 'active' : ''}`}
                      key={key}
                      onClick={() => setSelected(key)}
                    >
                      {slotButtonLabels[key]}
                    </button>
                  ))}
                  <h3>컴포넌트 ({layout.components.length}/15)</h3>
                  {layout.components.map((c, i) => (
                    <div
                      key={c.id}
                      className={`ts-component ${selected === c.id ? 'active' : ''}`}
                    >
                      <button onClick={() => setSelected(c.id)}>
                        {i + 1}. {c.name}
                      </button>
                      <span>
                        <button
                          aria-label={`${c.name} 위로`}
                          disabled={i === 0}
                          onClick={() =>
                            changeLayout((l) => {
                              [l.components[i - 1], l.components[i]] = [
                                l.components[i],
                                l.components[i - 1],
                              ];
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${c.name} 아래로`}
                          disabled={i === layout.components.length - 1}
                          onClick={() =>
                            changeLayout((l) => {
                              [l.components[i], l.components[i + 1]] = [
                                l.components[i + 1],
                                l.components[i],
                              ];
                            })
                          }
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`${c.name} 삭제`}
                          onClick={() =>
                            ask({
                              text: `${c.name}을 삭제하시겠습니까?`,
                              run: () => {
                                changeLayout((l) => {
                                  l.components = l.components.filter(
                                    (x) => x.id !== c.id
                                  );
                                });
                                setSelected('container');
                              },
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  ))}
                  <select
                    aria-label="컴포넌트 추가"
                    value=""
                    onChange={(e) => {
                      const type = e.target.value as SaleComponent['type'];
                      if (layout.components.length >= 15) {
                        saleToast(
                          '컴포넌트는 최대 15개까지 추가할 수 있습니다.',
                          true
                        );
                        return;
                      }
                      if (isShelf(type) && hasShelf) {
                        saleToast(
                          "'캐로셀', '상품목록'은 매대에 오직 1개만 존재할 수 있습니다.",
                          true
                        );
                        return;
                      }
                      const c = createSaleComponent(type);
                      changeLayout((l) => l.components.push(c));
                      setSelected(c.id);
                    }}
                  >
                    <option value="">+ 컴포넌트 추가</option>
                    {Object.entries(typeLabels).map(([key, label]) => (
                      <option
                        key={key}
                        value={key}
                        disabled={isShelf(key) && hasShelf}
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ts-properties">
                  <h3>{selectionLabel(selected, component?.name)} 설정</h3>
                  {selected === 'container' ? (
                    <CssEditor
                      value={layout.css}
                      onChange={(css) =>
                        changeLayout((l) => {
                          l.css = css;
                        })
                      }
                    />
                  ) : selected === 'header' || selected === 'footer' ? (
                    <Field label="HTML / 변수">
                      <textarea
                        value={layout[selected]}
                        onChange={(e) =>
                          changeLayout((l) => {
                            l[selected] = e.target.value;
                          })
                        }
                      />
                    </Field>
                  ) : (
                    component && (
                      <>
                        <Field label="컴포넌트 이름">
                          <input
                            value={component.name}
                            onChange={(e) =>
                              changeComponent((c) => {
                                c.name = e.target.value;
                              })
                            }
                          />
                        </Field>
                        <Field label="컴포넌트 종류">
                          <select
                            value={component.type}
                            onChange={(e) =>
                              changeType(
                                e.target.value as SaleComponent['type']
                              )
                            }
                          >
                            {Object.entries(typeLabels).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label={
                            component.type === 'image'
                              ? '이미지 주소'
                              : '텍스트 / HTML / 변수'
                          }
                        >
                          <textarea
                            value={component.content}
                            onChange={(e) =>
                              changeComponent((c) => {
                                c.content = e.target.value;
                              })
                            }
                          />
                        </Field>
                        <div className="ts-inline">
                          {(['scheduled', 'active', 'ended'] as const).map(
                            (v) => (
                              <label key={v}>
                                <input
                                  type="checkbox"
                                  checked={component.states.includes(v)}
                                  onChange={(e) =>
                                    changeComponent((c) => {
                                      c.states = e.target.checked
                                        ? [...c.states, v]
                                        : c.states.filter((x) => x !== v);
                                    })
                                  }
                                />
                                {
                                  {
                                    scheduled: '예정',
                                    active: '진행',
                                    ended: '종료',
                                  }[v]
                                }
                              </label>
                            )
                          )}
                        </div>
                        {(
                          Object.keys(
                            optionLabels
                          ) as (keyof SaleComponent['options'])[]
                        )
                          .filter((k) => optionAppliesTo(component.type, k))
                          .map((k) => (
                            <Field key={k} label={optionLabels[k]}>
                              {typeof component.options[k] === 'boolean' ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(component.options[k])}
                                  onChange={(e) =>
                                    changeComponent((c) => {
                                      Object.assign(c.options, {
                                        [k]: e.target.checked,
                                      });
                                    })
                                  }
                                />
                              ) : k === 'timer' ? (
                                <select
                                  value={component.options.timer}
                                  onChange={(e) =>
                                    changeComponent((c) => {
                                      c.options.timer = e.target.value as
                                        | 'normal'
                                        | 'flip';
                                    })
                                  }
                                >
                                  <option value="normal">일반</option>
                                  <option value="flip">슬라이딩 플립</option>
                                </select>
                              ) : k === 'badge' ? (
                                <select
                                  value={component.options.badge}
                                  onChange={(e) =>
                                    changeComponent((c) => {
                                      c.options.badge = e.target.value;
                                    })
                                  }
                                >
                                  {[
                                    'none',
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
                                  ].map((v) => (
                                    <option key={v}>{v}</option>
                                  ))}
                                </select>
                              ) : optionInputType(k, component.options[k]) ===
                                'color' ? (
                                <TimeSaleColorPicker
                                  value={String(component.options[k])}
                                  transparentValue="#00000000"
                                  onChange={(color) =>
                                    changeComponent((c) => {
                                      Object.assign(c.options, { [k]: color });
                                    })
                                  }
                                />
                              ) : (
                                <input
                                  type={optionInputType(
                                    k,
                                    component.options[k]
                                  )}
                                  step="any"
                                  value={
                                    component.options[k] as string | number
                                  }
                                  onChange={(e) =>
                                    changeComponent((c) => {
                                      Object.assign(c.options, {
                                        [k]:
                                          typeof c.options[k] === 'number'
                                            ? Number(e.target.value)
                                            : e.target.value,
                                      });
                                    })
                                  }
                                />
                              )}
                            </Field>
                          ))}
                        {(component.type === 'carousel' ||
                          component.type === 'grid') && (
                          <>
                            {CSS_OPTION_KEYS.map((k) => (
                              <details key={k}>
                                <summary>{optionLabels[k]}</summary>
                                <CssEditor
                                  key={`${component.id}-${k}`}
                                  value={component.options[k] ?? {}}
                                  onChange={(css) =>
                                    changeComponent((c) => {
                                      c.options[k] = css;
                                    })
                                  }
                                />
                              </details>
                            ))}
                            <ProductTextsEditor
                              component={component}
                              onChange={(texts) =>
                                changeComponent((c) => {
                                  c.productTexts = texts;
                                })
                              }
                            />
                          </>
                        )}
                        <StateCssEditor
                          component={component}
                          onChange={(st, css) =>
                            changeComponent((c) => {
                              c.stateCss = { ...c.stateCss, [st]: css };
                            })
                          }
                        />
                        <CssEditor
                          key={component.id}
                          value={component.css}
                          onChange={(css) =>
                            changeComponent((c) => {
                              c.css = css;
                            })
                          }
                        />
                      </>
                    )
                  )}
                </div>
                <div className="ts-preview">
                  <div className="ts-preview-canvas" style={{ width }}>
                    <SaleRenderer
                      key={refresh}
                      settings={settings}
                      surface={surface}
                      platform={platform}
                      saleId="preview"
                      title="타임세일"
                      startsAt="2026-10-07T00:00:00Z"
                      endsAt="2026-10-08T00:00:00Z"
                      products={sampleProducts}
                      previewState={state}
                      previewAnchor={previewAnchor}
                      previewSoldOut={soldOut}
                      sanitizeHtml={sanitizeHtml}
                    />
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (open) return;

          setConfirmation(null);
          setResetText('');
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title ?? '확인'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.text}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation?.reset && (
            <input
              autoFocus
              aria-label="초기화 확인"
              className="h-12 w-full rounded border border-gray-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
              placeholder="여기에 초기화를 입력하세요."
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogAction
              className="cursor-pointer disabled:cursor-not-allowed"
              disabled={confirmation?.reset && resetText !== '초기화'}
              onClick={() => confirmation?.run()}
            >
              {confirmation?.reset ? '완료' : '예'}
            </AlertDialogAction>
            <AlertDialogCancel className="cursor-pointer">
              {confirmation?.reset ? '취소' : '아니오'}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

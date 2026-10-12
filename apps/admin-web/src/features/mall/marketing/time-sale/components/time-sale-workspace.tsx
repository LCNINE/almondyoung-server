'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  type SaleComponent,
} from '@packages/domain-types/time-sale';
import {
  SaleRenderer,
  previewAnchorFor,
  type SaleProduct,
  type SaleTab,
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
  isDefaultStyleModified,
  linkActiveStyle,
  saveNewStyle,
  shouldKeepDraftOnRefetch,
} from '../time-sale-model';
import { TimeSaleColorPicker } from './time-sale-color-picker';
import { CssEditor } from './time-sale-css-editor';
import { TimeSaleImageField } from './time-sale-image-field';
import './time-sale-workspace.css';
import {
  DoorOpen,
  CircleHelp,
  Timer,
  PanelsTopLeft,
  List,
  Tags,
  Settings,
  Menu,
} from 'lucide-react';
import { TimeSaleDialog, TimeSaleHelpDialog } from './time-sale-dialog';

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
  management: '타임세일',
  main: '메인 매대 스타일',
  more: '더보기 화면 스타일',
  variables: '사용자 정의 변수',
  environment: '환경설정',
};

const typeLabels = {
  text: '텍스트/HTML',
  image: '이미지',
  button: '버튼',
  timer: '카운트다운 타이머',
  progress: '프로그레스바',
  carousel: '캐로셀',
  grid: '상품목록',
  tabs: '카테고리 탭',
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
  listCss: '캐러셀 / 상품목록 컨테이너',
  arrowCss: '슬라이드 이동 화살표 스타일',
  dotCss: '슬라이드 위치 표시 스타일',
  activeDotCss: '현재 위치 표시 스타일',
  pageCss: '페이지 번호 스타일',
  activePageCss: '현재 페이지 번호 스타일',
  showPages: '페이지 번호 보이기',
  pageWindow: '페이지 윈도우(번호 개수)',
  timerDigitCss: '타이머 숫자 스타일',
  timerLabelCss: '타이머 일시분초 스타일',
  timerSeparatorCss: '타이머 구분자 스타일',
  buttonCss: '버튼 스타일',
  progressCss: '프로그레스바 스타일',
  progressFillCss: '프로그레스 막대 스타일',
  showTimerLabels: '일시분초 보이기',
  timerLabels: '일시분초 텍스트',
  timerSeparators: '시간 텍스트 구분자',
  buttonAction: '버튼 클릭이벤트',
  href: '이동 주소',
  newWindow: '새 창 띄우기',
  disableProductLink: '상품 상세페이지 이동 비활성',
  productHref: '상품 상세페이지 주소',
  productOrder: '상품 진열방식',
  slots: '전체 슬롯 수',
  carouselRows: '캐러셀에 페이지 행 수 적용',
  slideGroup: '슬라이드 그룹(이동 상품 수)',
  direction: '상품 방향',
  imageType: '이미지 구분',
  imageContentGap: '이미지/내용 간격(px)',
  dotShape: '슬라이드 위치 표시 형태',
  membershipLabelOnly: '멤버십가는 「멤버십할인가」 표시만',
  discountCss: '할인율 CSS',
  tabCss: '탭 CSS',
  activeTabCss: '선택된 탭 CSS',
};

// 미리보기용 카테고리 탭(쇼핑몰은 세일 상품의 카테고리에서 만든다).
const sampleTabs: SaleTab[] = [
  ['all', '전체', 18],
  ['lash-perm', '속눈썹펌', 6],
  ['lash-ext', '속눈썹연장', 5],
  ['semi', '반영구', 4],
  ['nail', '네일아트', 3],
].map(([key, name, count]) => ({
  key: String(key),
  name: String(name),
  productIds: Array.from({ length: Number(count) }, (_, i) =>
    String((i * 3) % 18)
  ),
}));

const sampleProducts: SaleProduct[] = Array.from({ length: 18 }, (_, i) => ({
  id: String(i),
  name: `타임세일 상품 ${i + 1}`,
  image: `https://file.almondyoung.com/files/public/${i % 2 === 0 ? '01a0fc80-2423-714a-8ef9-402225e307fa' : '01a09e63-5f74-7629-a802-f00e7a54acd6'}`,
  href: '#',
  price: 19800 + i * 1000,
  originalPrice: 30000 + i * 1000,
  membershipPrice: 18800 + i * 1000,
  rating: i % 2 === 0 ? 4.9 : 4.7,
  reviewCount: i % 2 === 0 ? 204 : 7,
  soldOut: i % 5 === 0,
}));

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
  header: '머리말',
  container: '메인 컨테이너',
  footer: '꼬리말',
};

const editorTabs = ['sale', 'header', 'footer', 'container'] as const;

const selectionLabel = (selected: string, componentName?: string) => {
  if (selected === 'main-container') return '메인 컨테이너';
  if (selected === 'container') return '컨테이너';
  if (selected === 'header') return '머리말';
  if (selected === 'footer') return '꼬리말';
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

const extraCssOptions = {
  timer: ['timerDigitCss', 'timerLabelCss', 'timerSeparatorCss'],
  button: ['buttonCss'],
  progress: ['progressCss', 'progressFillCss'],
  carousel: ['listCss', 'discountCss', 'arrowCss', 'dotCss', 'activeDotCss'],
  grid: ['listCss', 'discountCss', 'pageCss', 'activePageCss'],
  tabs: ['tabCss', 'activeTabCss'],
  image: [],
  text: [],
} as const;

const extraOptionDefaults = {
  showTimerLabels: true,
  buttonAction: 'more',
  href: '',
  newWindow: false,
  disableProductLink: false,
  productHref: '',
  productOrder: 'priority',
  slots: 18,
  carouselRows: false,
  showPages: true,
  pageWindow: 5,
  slideGroup: 1,
  direction: 'column',
  imageType: 'list',
  imageContentGap: 0,
  dotShape: 'circle',
};

const optionChoices: Partial<
  Record<keyof SaleComponent['options'], [string, string][]>
> = {
  buttonAction: [
    ['more', '더보기 이동'],
    ['url', '주소 이동'],
  ],
  productOrder: [
    ['priority', '우선순위(정방향)'],
    ['reverse', '우선순위(역방향)'],
    ['random', '무작위'],
  ],
  direction: [
    ['column', '세로'],
    ['row', '가로'],
  ],
  imageType: [
    ['list', '목록 이미지'],
    ['detail', '상세 이미지'],
    ['small', '작은목록 이미지'],
    ['thumbnail', '축소 이미지'],
  ],
  dotShape: [
    ['circle', '원형핀'],
    ['square', '사각핀'],
    ['number', '숫자'],
  ],
};

// 상품 메시지 텍스트 최대 개수. 서버 검증(domain-types)의 상한과 같은 값이다.
const MAX_PRODUCT_TEXTS = 7;

// 컴포넌트 종류별로 편집 화면에 보여줄 옵션 키를
// 거른다(타이머·진행바·상품 목록이 각자 쓰는 옵션만).
const optionAppliesTo = (type: SaleComponent['type'], key: string) => {
  if (type === 'image') return key === 'imageWidth';
  if (key.endsWith('Css') || key === 'timerLabels' || key === 'timerSeparators')
    return false;
  if (key in extraOptionDefaults) {
    if (type === 'timer') return key === 'showTimerLabels';
    if (type === 'button')
      return ['buttonAction', 'href', 'newWindow'].includes(key);
    if (isShelf(type))
      return (
        !['showTimerLabels', 'buttonAction', 'href'].includes(key) &&
        (type === 'carousel' ||
          !['slots', 'slideGroup', 'dotShape', 'carouselRows'].includes(key))
      );
    return false;
  }
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

type ProductText = NonNullable<SaleComponent['productTexts']>[number];

function LayerMessagesEditor({
  component,
  onChange,
  progress = false,
}: {
  component: SaleComponent;
  progress?: boolean;
  onChange: (
    items:
      | NonNullable<SaleComponent['progressTexts']>
      | NonNullable<SaleComponent['imageLayers']>
  ) => void;
}) {
  const items = progress
    ? (component.progressTexts ?? [])
    : (component.imageLayers ?? []);
  const max = progress ? 3 : 4;
  const label = progress ? '프로그레스바 메시지' : '상품 이미지 레이어';

  const update = (
    index: number,
    patch: Partial<NonNullable<SaleComponent['progressTexts']>[number]>
  ) =>
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );

  return (
    <details>
      <summary>{label}</summary>
      <button
        type="button"
        disabled={items.length >= max}
        onClick={() =>
          onChange([
            ...items,
            {
              id: `message-${Date.now()}`,
              content: '{{condition}}',
              css: {},
              ...(progress ? { position: 'top' as const } : {}),
            },
          ])
        }
      >
        + {label} 추가
      </button>
      {items.map((item, index) => (
        <div key={item.id}>
          <div className="ts-actions">
            <span>
              {index + 1} / {max}
            </span>
            <button
              type="button"
              aria-label={`${label} ${index + 1} 삭제`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              삭제
            </button>
          </div>
          {progress && (
            <Field label="메시지 위치">
              <select
                value={
                  'position' in item && typeof item.position === 'string'
                    ? item.position
                    : 'top'
                }
                onChange={(e) =>
                  update(index, {
                    position: e.target.value as 'top' | 'inside' | 'bottom',
                  })
                }
              >
                <option value="top">상단</option>
                <option value="inside">내부</option>
                <option value="bottom">하단</option>
              </select>
            </Field>
          )}
          <Field label="메시지 형식">
            <textarea
              value={item.content}
              onChange={(e) => update(index, { content: e.target.value })}
            />
          </Field>
          <CssEditor
            value={item.css}
            onChange={(css) => update(index, { css })}
          />
        </div>
      ))}
    </details>
  );
}

function MoreScreenHelp() {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      const el = ref.current;

      if (el?.open && e.target instanceof Node && !el.contains(e.target))
        el.open = false;
    };

    document.addEventListener('pointerdown', close);

    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <details ref={ref} className="ts-title-help">
      <summary aria-label="더보기 화면 스타일 안내">
        <CircleHelp size={18} />
      </summary>
      <p>메인 매대의 더보기 버튼을 누르면 열리는 전체 목록 화면입니다.</p>
    </details>
  );
}

function ProductTextsEditor({
  component,
  onChange,
  position,
}: {
  component: SaleComponent;
  onChange: (texts: ProductText[]) => void;
  position?: ProductText['position'];
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
      <summary>
        {position
          ? {
              top: '상품 상단',
              header: '상품 머리말 내용',
              footer: '상품 꼬리말 내용',
              bottom: '상품 하단',
            }[position]
          : '상품 메시지 텍스트'}
      </summary>
      <button
        type="button"
        disabled={
          texts.filter((t) => t.position === (position ?? 'footer')).length >=
          MAX_PRODUCT_TEXTS
        }
        onClick={() =>
          onChange([
            ...texts,
            {
              id: `text-${Date.now()}`,
              position: position ?? 'footer',
              content: '{{product_name}}',
              css: {},
            },
          ])
        }
      >
        메시지 텍스트 추가
      </button>
      {texts.map((t, i) =>
        position && t.position !== position ? null : (
          <div key={t.id}>
            <strong>
              {
                texts
                  .slice(0, i + 1)
                  .filter((item) => item.position === t.position).length
              }{' '}
              / {MAX_PRODUCT_TEXTS}
            </strong>
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
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
                <option
                  value="top"
                  disabled={
                    t.position !== 'top' &&
                    texts.filter((item) => item.position === 'top').length >=
                      MAX_PRODUCT_TEXTS
                  }
                >
                  상품 상단
                </option>
                <option
                  value="header"
                  disabled={
                    t.position !== 'header' &&
                    texts.filter((item) => item.position === 'header').length >=
                      MAX_PRODUCT_TEXTS
                  }
                >
                  머리말
                </option>
                <option
                  value="footer"
                  disabled={
                    t.position !== 'footer' &&
                    texts.filter((item) => item.position === 'footer').length >=
                      MAX_PRODUCT_TEXTS
                  }
                >
                  꼬리말
                </option>
                <option
                  value="bottom"
                  disabled={
                    t.position !== 'bottom' &&
                    texts.filter((item) => item.position === 'bottom').length >=
                      MAX_PRODUCT_TEXTS
                  }
                >
                  상품 하단
                </option>
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
        )
      )}
    </details>
  );
}

// 타임세일 관리 화면의 공통 틀: 설정을 불러와 편집(update)·저장(save)하고
// 섹션(매대 스타일·환경설정)을 전환한다. 목록·등록 화면도 이 안에 들어간다.
export function TimeSaleWorkspace({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [helpOpen, setHelpOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [editorTab, setEditorTab] = useState('sale');
  const [importOpen, setImportOpen] = useState(false);
  const [fitPreview, setFitPreview] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(0);
  const previewViewport = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ['time-sale-settings'],
    // 저장된 적이 없으면 기본 스타일(라이브 쇼핑몰과 같은 모습)로 시작한다.
    queryFn: async () => {
      const result = await medusaTimeSaleSettingsApi.get();
      return {
        settings: result.settings ?? defaultTimeSaleSettings(),
        revision: result.revision,
      };
    },
  });

  const [settings, setSettings] = useState<TimeSaleSettings | null>(null),
    [revision, setRevision] = useState(''),
    [saved, setSaved] = useState(''),
    [saving, setSaving] = useState(false);

  // 마지막으로 불러오거나 저장한 설정과 지금 편집본이 다를 때만 변경으로 본다(되돌리면 풀린다).
  const dirty = useMemo(
    () => settings !== null && JSON.stringify(settings) !== saved,
    [settings, saved]
  );

  const loadSettings = (next: TimeSaleSettings) => {
    setSettings(structuredClone(next));
    setSaved(JSON.stringify(next));
  };

  const [section, setSection] = useState<keyof typeof sections>('management'),
    [platform, setPlatform] = useState<SalePlatform>('mobile'),
    [state, setState] = useState<SalePreviewState>('scheduled'),
    [soldOut, setSoldOut] = useState(false),
    [selected, setSelected] = useState('container'),
    [refresh, setRefresh] = useState(0),
    [previewAnchor, setPreviewAnchor] = useState(() =>
      previewAnchorFor('scheduled', Date.now())
    ),
    [width, setWidth] = useState(375);

  useEffect(() => {
    const viewport = previewViewport.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() =>
      setPreviewWidth(viewport.clientWidth)
    );
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [section, settings]);

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

  const resetVariableForm = () => {
    setEditingVariable(null);
    setVariableName('');
    setVariableDescription('');
    setVariablePreview('');
  };

  // 서버 설정을 편집본으로 복사한다. 편집 중(dirty)이거나 이미 같은 revision 이면 덮어쓰지 않는다.
  useEffect(() => {
    if (!query.data) return;
    if (
      shouldKeepDraftOnRefetch(dirty, query.data.revision, revision) &&
      settings
    )
      return;

    loadSettings(query.data.settings);
    setRevision(query.data.revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, dirty]);

  // 저장하지 않은 변경을 버리고 서버 설정으로 되돌린다(이동 확인 후).
  const discardDraft = () => {
    // 센티넬 정리는 dirty 효과(backGuard.sync)가 한 길로 맡는다. 라우트 이동이면 그 전에 release 된다.
    if (query.data) {
      loadSettings(query.data.settings);
      setRevision(query.data.revision);
    }
  };

  // dirty 면 확인창을 거쳐 편집본을 버리고 이동하고, 아니면 바로 이동한다.
  const guarded = (
    go: () => void,
    text = '수정 사항이 존재합니다. 무시하고 탭을 이동하시겠습니까?'
  ) => {
    if (!dirty) return go();

    ask({
      title: '확인',
      text,
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

  // 설정 편집본을 복제해 고친다(원본 불변).
  const update = (run: (s: TimeSaleSettings) => void) => {
    if (!settings) return;
    const next = structuredClone(settings);
    run(next);
    setSettings(next);
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
      if (section === 'main' || section === 'more')
        linkActiveStyle(toSave, section, platform);

      validateTimeSaleSettings(toSave);

      setSaving(true);
      const result = await medusaTimeSaleSettingsApi.save(toSave, revision);

      setRevision(result.revision);
      loadSettings(result.settings);
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

  const surface: SaleSurface = section === 'more' ? 'more' : 'main';

  const layout = settings?.styles[surface][platform];
  const component = layout?.components.find((c) => c.id === selected);
  const hasShelf = !!layout?.components.some((c) => isShelf(c.type));
  const defaultModified =
    !!settings && isDefaultStyleModified(settings, surface, platform);

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
      setEditorTab('sale');
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

  const defaultMainWidth = platform === 'mobile' ? '100%' : '1280px';

  const optionField = (k: keyof SaleComponent['options']) => {
    if (!component) return null;

    const value =
      component.options[k] ??
      extraOptionDefaults[k as keyof typeof extraOptionDefaults];

    if (typeof value === 'number') {
      const limits: Partial<Record<keyof SaleComponent['options'], number>> = {
        imageWidth: 100,
        imageRadius: 100,
        badgeSize: 100,
        imageContentGap: 100,
        gap: 100,
        slots: 60,
        pageWindow: 20,
      };
      const min = [
        'imageWidth',
        'badgeSize',
        'slots',
        'pageWindow',
        'slideGroup',
      ].includes(k)
        ? 1
        : 0;
      const change = (next: string) =>
        changeComponent((item) => {
          Object.assign(item.options, { [k]: Number(next) });
        });

      return (
        <Field key={k} label={optionLabels[k]}>
          <div className="ts-option-range">
            <input
              type="number"
              aria-label={optionLabels[k]}
              step="any"
              value={value}
              onChange={(event) => change(event.target.value)}
            />
            <input
              type="range"
              aria-label={`${optionLabels[k]} 슬라이더`}
              min={min}
              max={Math.max(value, limits[k] ?? 100)}
              step="1"
              value={value}
              onChange={(event) => change(event.target.value)}
            />
          </div>
        </Field>
      );
    }

    return (
      <Field key={k} label={optionLabels[k]}>
        {typeof value === 'boolean' ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) =>
              changeComponent((c) => {
                Object.assign(c.options, {
                  [k]: e.target.checked,
                });
              })
            }
          />
        ) : optionChoices[k] ? (
          <select
            value={String(value)}
            onChange={(e) =>
              changeComponent((c) =>
                Object.assign(c.options, { [k]: e.target.value })
              )
            }
          >
            {optionChoices[k]!.map(([option, label]) => (
              <option key={option} value={option}>
                {label}
              </option>
            ))}
          </select>
        ) : k === 'timer' ? (
          <select
            value={component.options.timer}
            onChange={(e) =>
              changeComponent((c) => {
                c.options.timer = e.target.value as 'normal' | 'flip';
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
        ) : optionInputType(k, component.options[k]) === 'color' ? (
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
            type={optionInputType(k, value)}
            step="any"
            value={value as string | number}
            onChange={(e) =>
              changeComponent((c) => {
                Object.assign(c.options, {
                  [k]:
                    typeof value === 'number'
                      ? Number(e.target.value)
                      : e.target.value,
                });
              })
            }
          />
        )}
      </Field>
    );
  };

  const decoration =
    selected === 'header' || selected === 'footer' ? selected : null;
  const decorationControls =
    decoration && layout ? (
      <div className="ts-properties">
        <fieldset>
          <legend>표시</legend>
          <Field label="보이기">
            <input
              type="checkbox"
              checked={layout[`${decoration}Options`]?.enabled ?? true}
              onChange={(e) =>
                changeLayout((l) => {
                  l[`${decoration}Options`] = {
                    type: 'text',
                    css: {},
                    ...l[`${decoration}Options`],
                    enabled: e.target.checked,
                  };
                })
              }
            />
          </Field>
        </fieldset>
        <fieldset>
          <legend>내용</legend>
          <Field label="내용 유형">
            <select
              value={layout[`${decoration}Options`]?.type ?? 'text'}
              onChange={(e) =>
                changeLayout((l) => {
                  l[`${decoration}Options`] = {
                    enabled: true,
                    css: {},
                    ...l[`${decoration}Options`],
                    type: e.target.value as 'text' | 'image',
                  };
                })
              }
            >
              <option value="text">텍스트/HTML</option>
              <option value="image">이미지</option>
            </select>
          </Field>
        </fieldset>
      </div>
    ) : null;

  const properties = layout ? (
    <div className="ts-properties">
      <h3>{selectionLabel(selected, component?.name)} 설정</h3>
      {selected === 'main-container' && (
        <fieldset>
          <legend>규격</legend>
          <Field label="가로 최대">
            <input
              type="number"
              min={1}
              value={
                parseFloat(
                  String(layout.mainCss?.maxWidth ?? defaultMainWidth)
                ) || 100
              }
              onChange={(e) =>
                changeLayout((item) => {
                  const unit = String(
                    item.mainCss?.maxWidth ?? defaultMainWidth
                  ).endsWith('%')
                    ? '%'
                    : 'px';

                  item.mainCss = {
                    ...item.mainCss,
                    maxWidth: `${Math.max(1, Number(e.target.value))}${unit}`,
                  };
                })
              }
            />
          </Field>
          <input
            aria-label="가로 최대 슬라이더"
            type="range"
            min={1}
            max={
              String(layout.mainCss?.maxWidth ?? defaultMainWidth).endsWith('%')
                ? 100
                : 2000
            }
            value={
              parseFloat(
                String(layout.mainCss?.maxWidth ?? defaultMainWidth)
              ) || 100
            }
            onChange={(event) =>
              changeLayout((item) => {
                const unit = String(
                  item.mainCss?.maxWidth ?? defaultMainWidth
                ).endsWith('%')
                  ? '%'
                  : 'px';
                item.mainCss = {
                  ...item.mainCss,
                  maxWidth: `${event.target.value}${unit}`,
                };
              })
            }
          />
          <Field label="단위">
            <select
              value={
                String(layout.mainCss?.maxWidth ?? defaultMainWidth).endsWith(
                  '%'
                )
                  ? '%'
                  : 'px'
              }
              onChange={(e) =>
                changeLayout((item) => {
                  const width =
                    parseFloat(
                      String(item.mainCss?.maxWidth ?? defaultMainWidth)
                    ) || 100;

                  item.mainCss = {
                    ...item.mainCss,
                    maxWidth: `${width}${e.target.value}`,
                  };
                })
              }
            >
              <option value="%">% - 퍼센트</option>
              <option value="px">px - 픽셀</option>
            </select>
          </Field>
          <Field label="컨테이너 수평 정렬">
            <select
              value={
                (layout.mainCss?.marginLeft ?? 'auto') === 'auto'
                  ? (layout.mainCss?.marginRight ?? 'auto') === 'auto'
                    ? 'center'
                    : 'right'
                  : 'left'
              }
              onChange={(e) =>
                changeLayout((item) => {
                  item.mainCss = {
                    ...item.mainCss,
                    marginLeft: e.target.value === 'left' ? '0' : 'auto',
                    marginRight: e.target.value === 'right' ? '0' : 'auto',
                  };
                })
              }
            >
              <option value="left">왼쪽</option>
              <option value="center">가운데</option>
              <option value="right">오른쪽</option>
            </select>
          </Field>
        </fieldset>
      )}
      {selected === 'container' || selected === 'main-container' ? (
        <CssEditor
          containerOnly
          value={
            selected === 'main-container' ? (layout.mainCss ?? {}) : layout.css
          }
          onChange={(css) =>
            changeLayout((l) => {
              if (selected === 'main-container') l.mainCss = css;
              else l.css = css;
            })
          }
        />
      ) : selected === 'header' || selected === 'footer' ? (
        <div className="ts-text-editor">
          <details name={`decoration-${selected}`}>
            <summary>
              {layout[`${selected}Options`]?.type === 'image'
                ? '이미지 내용'
                : '텍스트/HTML 내용'}
            </summary>
            <div className="ts-css-body">
              <div className="ts-field">
                {layout[`${selected}Options`]?.type === 'image' ? (
                  <TimeSaleImageField
                    value={layout[selected]}
                    onChange={(content) =>
                      changeLayout((item) => {
                        item[selected] = content;
                      })
                    }
                  />
                ) : (
                  <textarea
                    aria-label="HTML / 변수"
                    value={layout[selected]}
                    onChange={(e) =>
                      changeLayout((l) => {
                        l[selected] = e.target.value;
                      })
                    }
                  />
                )}
              </div>
            </div>
          </details>
          <CssEditor
            key={selected}
            accordionName={`decoration-${selected}`}
            value={layout[`${selected}Options`]?.css ?? {}}
            onChange={(css) =>
              changeLayout((l) => {
                l[`${selected}Options`] = {
                  enabled: true,
                  type: 'text',
                  ...l[`${selected}Options`],
                  css,
                };
              })
            }
          />
        </div>
      ) : component && isShelf(component.type) ? (
        <div className="ts-component-editor">
          <details name={`shelf-${component.id}`} open>
            <summary>{typeLabels[component.type]}</summary>
            <div className="ts-css-body">
              {(['columns', 'rows'] as const).map((key) => (
                <label className="ts-shelf-range" key={key}>
                  <span>
                    {key === 'columns' ? '가로-열(cols)' : '세로-행(rows)'} :{' '}
                    {component.options[key]}개
                  </span>
                  <input
                    type="range"
                    aria-label={key === 'columns' ? '가로 열 수' : '세로 행 수'}
                    min="1"
                    max={key === 'columns' ? 8 : 10}
                    step="1"
                    value={component.options[key]}
                    onChange={(event) =>
                      changeComponent((item) => {
                        item.options[key] = Number(event.target.value);
                      })
                    }
                  />
                </label>
              ))}
              {component.type === 'carousel' &&
                [
                  'slots',
                  'slideGroup',
                  'carouselRows',
                  'autoplay',
                  'delay',
                  'duration',
                  'loop',
                  'arrows',
                  'dots',
                  'dotShape',
                ].map((key) =>
                  optionField(key as keyof SaleComponent['options'])
                )}
            </div>
          </details>
          <details name={`shelf-${component.id}`}>
            <summary>상품 속성</summary>
            <div className="ts-css-body">
              {[
                'productOrder',
                'direction',
                'gap',
                'imageType',
                'imageWidth',
                'imageRadius',
                'imageContentGap',
                'showOriginal',
                'showDiscount',
                'overlay',
              ].map((key) =>
                optionField(key as keyof SaleComponent['options'])
              )}
              {[
                'productCss',
                'soldOutCss',
                'scheduledCss',
                'endedCss',
                'imageCss',
              ].map((key) => (
                <details key={key}>
                  <summary>
                    {optionLabels[key as keyof SaleComponent['options']]}
                  </summary>
                  <CssEditor
                    jsonOnly
                    value={
                      component.options[
                        key as (typeof CSS_OPTION_KEYS)[number]
                      ] ?? {}
                    }
                    onChange={(css) =>
                      changeComponent((item) => {
                        Object.assign(item.options, { [key]: css });
                      })
                    }
                  />
                </details>
              ))}
            </div>
          </details>
          <details name={`shelf-${component.id}`}>
            <summary>상품 상세페이지 주소</summary>
            <div className="ts-css-body">
              {['disableProductLink', 'productHref', 'newWindow'].map((key) =>
                optionField(key as keyof SaleComponent['options'])
              )}
            </div>
          </details>
          <details name={`shelf-${component.id}`}>
            <summary>상품 이미지 엠블럼</summary>
            <div className="ts-css-body">
              {['badge', 'badgeSize', 'badgeColor'].map((key) =>
                optionField(key as keyof SaleComponent['options'])
              )}
              <CssEditor
                jsonOnly
                value={component.options.badgeCss ?? {}}
                onChange={(css) =>
                  changeComponent((item) => {
                    item.options.badgeCss = css;
                  })
                }
              />
            </div>
          </details>
          <LayerMessagesEditor
            component={component}
            onChange={(items) =>
              changeComponent((item) => {
                item.imageLayers = items;
              })
            }
          />
          {(['top', 'header', 'footer', 'bottom'] as const).map((position) => (
            <ProductTextsEditor
              key={position}
              position={position}
              component={component}
              onChange={(texts) =>
                changeComponent((item) => {
                  item.productTexts = texts;
                })
              }
            />
          ))}
          <details name={`shelf-${component.id}`}>
            <summary>
              {component.type === 'grid'
                ? '상품 페이지 설정'
                : '캐로셀 컨테이너'}
            </summary>
            <div className="ts-css-body">
              {component.type === 'grid' &&
                ['showPages', 'pageWindow'].map((key) =>
                  optionField(key as keyof SaleComponent['options'])
                )}
              {extraCssOptions[component.type as 'grid' | 'carousel'].map(
                (key) => (
                  <details key={key}>
                    <summary>{optionLabels[key]}</summary>
                    <CssEditor
                      jsonOnly
                      value={component.options[key] ?? {}}
                      onChange={(css) =>
                        changeComponent((item) => {
                          item.options[key] = css;
                        })
                      }
                    />
                  </details>
                )
              )}
            </div>
          </details>
          <CssEditor
            showFont={false}
            value={component.css}
            onChange={(css) =>
              changeComponent((item) => {
                item.css = css;
              })
            }
          />
        </div>
      ) : component?.type === 'image' ? (
        <div className="ts-component-editor">
          <details name={`image-${component.id}`} open>
            <summary>이미지 내용</summary>
            <div className="ts-css-body">
              <TimeSaleImageField
                value={component.content}
                onChange={(content) =>
                  changeComponent((item) => {
                    item.content = content;
                  })
                }
              />
              {optionField('imageWidth')}
            </div>
          </details>
          <CssEditor
            accordionName={`image-${component.id}`}
            value={component.css}
            onChange={(css) =>
              changeComponent((item) => {
                item.css = css;
              })
            }
          />
        </div>
      ) : component?.type === 'text' ? (
        <div className="ts-text-editor">
          <details name={`component-${component.id}`}>
            <summary>텍스트/HTML 내용</summary>
            <div className="ts-css-body">
              <Field label="텍스트 / HTML / 변수">
                <textarea
                  aria-label="텍스트 / HTML / 변수"
                  value={component.content}
                  onChange={(event) =>
                    changeComponent((item) => {
                      item.content = event.target.value;
                    })
                  }
                />
              </Field>
            </div>
          </details>
          <CssEditor
            key={component.id}
            accordionName={`component-${component.id}`}
            value={component.css}
            onChange={(css) =>
              changeComponent((item) => {
                item.css = css;
              })
            }
          />
        </div>
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
                  changeType(e.target.value as SaleComponent['type'])
                }
              >
                {Object.entries(typeLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {component.type !== 'timer' && !isShelf(component.type) && (
              <Field label={'텍스트 / HTML / 변수'}>
                <textarea
                  value={component.content}
                  onChange={(e) =>
                    changeComponent((c) => {
                      c.content = e.target.value;
                    })
                  }
                />
              </Field>
            )}
            {(Object.keys(optionLabels) as (keyof SaleComponent['options'])[])
              .filter((k) => optionAppliesTo(component.type, k))
              .map(optionField)}
            {(component.type === 'carousel' || component.type === 'grid') && (
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
            {component.type === 'timer' &&
              (['timerLabels', 'timerSeparators'] as const).map((key) => (
                <details key={key}>
                  <summary>{optionLabels[key]}</summary>
                  {['일', '시', '분', '초'].map((label, index) => (
                    <Field
                      key={label}
                      label={`${label} ${key === 'timerLabels' ? '단위 텍스트' : '텍스트 구분자'}`}
                    >
                      <input
                        value={
                          component.options[key]?.[index] ??
                          (key === 'timerLabels'
                            ? ['일', '시간', '분', '초'][index]
                            : '')
                        }
                        onChange={(e) =>
                          changeComponent((c) => {
                            const values = [
                              ...(c.options[key] ??
                                (key === 'timerLabels'
                                  ? ['일', '시간', '분', '초']
                                  : ['', '', '', ''])),
                            ];
                            values[index] = e.target.value;
                            c.options[key] = values;
                          })
                        }
                      />
                    </Field>
                  ))}
                </details>
              ))}
            {extraCssOptions[component.type].map((key) => (
              <details key={key}>
                <summary>{optionLabels[key]}</summary>
                <CssEditor
                  key={`${component.id}-${key}`}
                  value={component.options[key] ?? {}}
                  onChange={(css) =>
                    changeComponent((c) => {
                      c.options[key] = css;
                    })
                  }
                />
              </details>
            ))}
            {isShelf(component.type) && (
              <LayerMessagesEditor
                component={component}
                onChange={(items) =>
                  changeComponent((c) => {
                    c.imageLayers = items;
                  })
                }
              />
            )}
            {component.type === 'progress' && (
              <LayerMessagesEditor
                component={component}
                progress
                onChange={(items) =>
                  changeComponent((c) => {
                    c.progressTexts = items as NonNullable<
                      SaleComponent['progressTexts']
                    >;
                  })
                }
              />
            )}
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
  ) : null;

  return (
    <div className="ts-workspace">
      {navigationOpen && (
        <aside className="ts-navigation">
          <div className="ts-navigation-brand">
            타임세일{' '}
            <button
              aria-label="메뉴 닫기"
              onClick={() => setNavigationOpen(false)}
            >
              ‹
            </button>
          </div>
          {Object.entries(sections).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={section === key ? 'active' : ''}
              onClick={() => switchSection(key as keyof typeof sections)}
            >
              {(() => {
                const Icon = {
                  management: Timer,
                  main: PanelsTopLeft,
                  more: List,
                  variables: Tags,
                  environment: Settings,
                }[key as keyof typeof sections];

                return <Icon size={20} />;
              })()}
              {label}
            </button>
          ))}
        </aside>
      )}
      <div className="ts-body">
        <header className="ts-appbar">
          <button
            className="ts-appbar-icon"
            aria-label="타임세일 메뉴"
            title="타임세일 메뉴"
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            <Menu size={22} />
          </button>
          <strong>{sections[section]}</strong>
          {(section === 'environment' || section === 'variables') && (
            <>
              <span>{dirty ? '저장되지 않은 변경 사항' : '저장됨'}</span>
              <button
                disabled={!dirty || saving || !settings || query.isError}
                onClick={() => void save(saveMessage(section, selected))}
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </>
          )}
          <button
            className="ts-appbar-icon"
            aria-label="위치 지정 HTML Tag안내"
            title="위치 지정 HTML Tag안내"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={21} />
          </button>
          <button
            className="ts-new-window"
            onClick={() =>
              window.open(
                '/mall/marketing/time-sale',
                '_blank',
                'noopener,noreferrer'
              )
            }
          >
            새 창 띄우기
          </button>
          <button
            className="ts-appbar-icon"
            aria-label="메인페이지로 나가기"
            title="메인페이지로 나가기"
            onClick={() => guarded(() => router.push('/'))}
          >
            <DoorOpen size={22} />
          </button>
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
            {(['main', 'more'] as const).map((key) => (
              <Field
                key={key}
                label={
                  {
                    main: '메인 매대 노출',
                    more: '더보기 화면 노출',
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
                            run: () => {
                              if (editingVariable === v.name)
                                resetVariableForm();

                              update((s) => {
                                s.variables = s.variables.filter(
                                  (x) => x.name !== v.name
                                );
                              });
                            },
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

                resetVariableForm();
              }}
            >
              {' '}
              {editingVariable ? '수정' : '추가'}
            </button>
            <button onClick={resetVariableForm}>취소</button>
          </div>
        ) : (
          layout && (
            <>
              <div className="ts-toolbar">
                <h2>
                  <span>{platform === 'mobile' ? '모바일' : 'PC'}</span>{' '}
                  {sections[section]}
                  {section === 'more' && <MoreScreenHelp />}
                </h2>
                <select
                  aria-label="프리뷰 상태"
                  value={state}
                  onChange={(e) => {
                    const next = e.target.value as SalePreviewState;

                    guarded(() => {
                      setState(next);
                      setPreviewAnchor(previewAnchorFor(next, Date.now()));
                    }, '수정 사항이 존재합니다. 무시하고 타임세일 상태를 변경 하시겠습니까?');
                  }}
                >
                  <option value="scheduled">예정(대기중)</option>
                  <option value="active">할인(실행중)</option>
                  <option value="ended">마감(중지)</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={soldOut}
                    onChange={(e) => {
                      const next = e.target.checked;

                      guarded(
                        () => setSoldOut(next),
                        '수정 사항이 존재합니다. 무시하고 품절 모드로 변경 하시겠습니까?'
                      );
                    }}
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
                          setEditorTab('sale');
                          setSelected('container');
                        }, '수정 사항이 존재합니다. 무시하고 플랫폼을 변경 하시겠습니까?')
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
              </div>
              <div
                className={`ts-editor ${component || decoration ? 'ts-editor-selected' : ''}`}
              >
                <div className="ts-style-panel">
                  <div
                    className="ts-style-tabs"
                    role="tablist"
                    aria-label="매대 스타일 편집"
                  >
                    {editorTabs.map((tab, index) => (
                      <button
                        key={tab}
                        id={`ts-tab-${tab}`}
                        role="tab"
                        aria-selected={editorTab === tab}
                        aria-controls="ts-style-tabpanel"
                        tabIndex={editorTab === tab ? 0 : -1}
                        onKeyDown={(event) => {
                          if (
                            ![
                              'ArrowLeft',
                              'ArrowRight',
                              'Home',
                              'End',
                            ].includes(event.key)
                          )
                            return;

                          event.preventDefault();

                          const nextIndex =
                            event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? editorTabs.length - 1
                                : (index +
                                    (event.key === 'ArrowRight' ? 1 : -1) +
                                    editorTabs.length) %
                                  editorTabs.length;
                          const next = document.getElementById(
                            `ts-tab-${editorTabs[nextIndex]}`
                          );

                          next?.focus();
                          next?.click();
                        }}
                        onClick={() => {
                          if (tab === editorTab) return;

                          guarded(() => {
                            setEditorTab(tab);
                            setSelected(
                              tab === 'sale'
                                ? 'container'
                                : tab === 'container'
                                  ? 'main-container'
                                  : tab
                            );
                          });
                        }}
                      >
                        {tab === 'sale' ? '타임세일' : slotButtonLabels[tab]}
                      </button>
                    ))}
                  </div>
                  <div
                    className="ts-style-scroll"
                    role="tabpanel"
                    id="ts-style-tabpanel"
                    aria-labelledby={`ts-tab-${editorTab}`}
                  >
                    {editorTab === 'sale' && (
                      <div className="ts-components">
                        <Field label="매대 선택">
                          <select
                            aria-label="매대 선택"
                            value={layout.id}
                            onChange={(e) => {
                              const next = e.target.value;

                              const selectStyle = () => {
                                const style =
                                  settings.savedStyles.find(
                                    (item) => item.id === next
                                  ) ??
                                  defaultTimeSaleSettings().styles[surface][
                                    platform
                                  ];

                                update((draft) => {
                                  draft.styles[surface][platform] =
                                    structuredClone(style);
                                });
                                setSelected('container');
                              };

                              if (dirty)
                                ask({
                                  text: '현재 매대의 수정 사항을 선택한 스타일로 덮어쓰시겠습니까?',
                                  run: selectStyle,
                                });
                              else selectStyle();
                            }}
                          >
                            {defaultModified && (
                              <option value={`${surface}-${platform}`}>
                                기본 (수정됨)
                              </option>
                            )}
                            {/* 라이브러리에 없는 id 라 고르면 초기값을 불러온다. */}
                            <option
                              value={
                                defaultModified
                                  ? 'default-reset'
                                  : `${surface}-${platform}`
                              }
                            >
                              기본
                            </option>
                            {settings.savedStyles.map((style) => (
                              <option key={style.id} value={style.id}>
                                {style.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="ts-actions">
                          <button
                            onClick={() => {
                              if (settings.savedStyles.length >= 50) {
                                saleToast('스타일은 최대 50개입니다.', true);
                                return;
                              }

                              ask({
                                text: '신규 매대 스타일을 추가 하시겠습니까?',
                                run: () => {
                                  update((s) =>
                                    saveNewStyle(
                                      s,
                                      surface,
                                      platform,
                                      `style-${Date.now()}`
                                    )
                                  );
                                  saleToast('신규 스타일을 생성하였습니다.');
                                },
                              });
                            }}
                          >
                            + 매대 추가
                          </button>
                          <button onClick={() => setImportOpen(true)}>
                            가져오기
                          </button>
                          <button
                            disabled={
                              !canDeleteSavedStyle(settings, surface, platform)
                            }
                            onClick={() =>
                              ask({
                                text: `[${layout.name}] 스타일을 삭제하시겠습니까? 변경 사항을 저장하면 삭제된 스타일은 복구할 수 없습니다. 삭제를 취소하려면 아니오를 선택하세요.`,
                                run: () =>
                                  update((s) =>
                                    deleteSavedStyle(s, surface, platform)
                                  ),
                              })
                            }
                          >
                            삭제
                          </button>
                        </div>
                        <fieldset className="ts-style-name">
                          <legend>매대 스타일명</legend>
                          <input
                            aria-label="스타일 이름"
                            value={layout.name}
                            maxLength={100}
                            onChange={(e) =>
                              changeLayout((item) => {
                                item.name = e.target.value;
                              })
                            }
                          />
                        </fieldset>
                        <h3>
                          기본 <span>({layout.components.length}/15)</span>
                        </h3>
                        {layout.components.map((c, i) => (
                          <div
                            key={c.id}
                            className={`ts-component ${selected === c.id ? 'active' : ''}`}
                          >
                            <button onClick={() => setSelected(c.id)}>
                              {i + 1} / 15
                            </button>
                            <select
                              aria-label={`${i + 1}번째 구성요소 종류`}
                              value={c.type}
                              onFocus={() => setSelected(c.id)}
                              onChange={(e) => {
                                const type = e.target
                                  .value as SaleComponent['type'];

                                if (
                                  isShelf(type) &&
                                  layout.components.some(
                                    (item) =>
                                      item.id !== c.id && isShelf(item.type)
                                  )
                                ) {
                                  saleToast(
                                    '캐로셀, 상품목록은 매대에 오직 1개만 존재할 수 있습니다.',
                                    true
                                  );
                                  return;
                                }

                                changeLayout((item) =>
                                  Object.assign(
                                    item.components[i],
                                    createSaleComponent(type, c.id)
                                  )
                                );
                                setSelected(c.id);
                              }}
                            >
                              {Object.entries(typeLabels).map(
                                ([type, label]) => (
                                  <option
                                    key={type}
                                    value={type}
                                    disabled={
                                      isShelf(type) &&
                                      hasShelf &&
                                      !isShelf(c.type)
                                    }
                                  >
                                    {label}
                                  </option>
                                )
                              )}
                            </select>
                            <span>
                              <button
                                className="ts-component-move"
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
                                className="ts-component-move"
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
                                      if (selected === c.id)
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
                            const type = e.target
                              .value as SaleComponent['type'];
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
                        <p className="ts-style-hint">
                          캐로셀, 상품목록은 매대에 오직 1개만 존재할 수
                          있습니다.
                        </p>
                      </div>
                    )}
                    {decorationControls}
                    {!component && !decoration && properties}
                  </div>
                  <div className="ts-style-footer">
                    <button
                      className="ts-button ts-button-primary"
                      onClick={() =>
                        ask({
                          text:
                            editorTab === 'sale'
                              ? RESET_STYLE_TEXT
                              : "초기화를 진행합니다. 안전하게 진행하기 위해 입력란에 '초기화'를 입력하여 주십시오.",
                          reset: true,
                          run: () => {
                            changeLayout((item) => {
                              const defaults =
                                defaultTimeSaleSettings().styles[surface][
                                  platform
                                ];

                              if (
                                editorTab === 'header' ||
                                editorTab === 'footer'
                              ) {
                                item[editorTab] = '';
                                delete item[`${editorTab}Options`];
                              } else if (editorTab === 'container')
                                item.mainCss = defaults.mainCss ?? {};
                              else
                                Object.assign(item, defaults, {
                                  id: item.id,
                                  name: item.name,
                                });
                            });
                            setSelected(
                              editorTab === 'sale'
                                ? 'container'
                                : editorTab === 'container'
                                  ? 'main-container'
                                  : editorTab
                            );
                          },
                        })
                      }
                    >
                      초기화
                    </button>
                    <button
                      className="ts-button ts-button-primary"
                      disabled={!dirty || saving}
                      onClick={() => void save(saveMessage(section, selected))}
                    >
                      {saving ? '저장 중…' : '저장'}
                    </button>
                    <span role="status">
                      {dirty ? '저장되지 않은 변경 사항' : '저장됨'}
                    </span>
                  </div>
                </div>
                {(component || decoration) && properties}
                <div className="ts-preview">
                  <div className="ts-preview-toolbar">
                    <label>
                      Viewport width:{' '}
                      <input
                        type="number"
                        aria-label="프리뷰 폭"
                        disabled={editorTab !== 'sale'}
                        min={280}
                        max={1600}
                        value={width}
                        onChange={(e) =>
                          setWidth(
                            Math.min(
                              1600,
                              Math.max(280, Number(e.target.value))
                            )
                          )
                        }
                      />{' '}
                      px
                    </label>
                    <input
                      type="range"
                      aria-label="프리뷰 폭 슬라이더"
                      disabled={editorTab !== 'sale'}
                      min={280}
                      max={1600}
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                    />
                    <button
                      className="ts-button"
                      disabled={editorTab !== 'sale'}
                      onClick={() =>
                        setWidth(platform === 'mobile' ? 375 : 1000)
                      }
                    >
                      기본 설정
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={fitPreview}
                        onChange={(e) => setFitPreview(e.target.checked)}
                      />{' '}
                      화면에 맞춤
                    </label>
                    <span>
                      메인 컨테이너 (w:{' '}
                      {layout.mainCss?.maxWidth ||
                        layout.mainCss?.width ||
                        defaultMainWidth}
                      )
                    </span>
                  </div>
                  <div
                    className="ts-preview-viewport"
                    ref={previewViewport}
                    tabIndex={0}
                    aria-label="매대 프리뷰, 가로 스크롤 가능"
                  >
                    <div
                      className="ts-preview-canvas"
                      style={{
                        width,
                        zoom:
                          fitPreview && previewWidth
                            ? Math.min(1, previewWidth / width)
                            : 1,
                      }}
                    >
                      <SaleRenderer
                        key={refresh}
                        settings={{
                          ...settings,
                          environment: {
                            ...settings.environment,
                            [surface]: true,
                          },
                        }}
                        surface={surface}
                        platform={platform}
                        title="타임세일"
                        tabs={sampleTabs}
                        startsAt="2026-10-07T00:00:00Z"
                        endsAt="2026-10-08T00:00:00Z"
                        products={sampleProducts}
                        previewState={state}
                        previewAnchor={previewAnchor}
                        previewSoldOut={soldOut}
                        onPreviewSelect={(id) => {
                          const tab =
                            id === 'header' || id === 'footer' ? id : 'sale';
                          const select = () => {
                            setEditorTab(tab);
                            setSelected(id);
                          };

                          if (tab !== editorTab) guarded(select);
                          else select();
                        }}
                        previewSelected={selected}
                        sanitizeHtml={sanitizeHtml}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
      <TimeSaleDialog
        open={importOpen}
        title="진열매대 선택"
        onClose={() => setImportOpen(false)}
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th>위치</th>
              <th>스타일명칭</th>
              <th>플랫폼</th>
              <th>선택</th>
            </tr>
          </thead>
          <tbody>
            {settings &&
              [
                ...(['main', 'more'] as const).flatMap((location) =>
                  (['mobile', 'pc'] as const).map((device) => ({
                    style: settings.styles[location][device],
                    location: sections[location],
                    device: device === 'mobile' ? '모바일' : 'PC',
                    current: location === section && device === platform,
                  }))
                ),
                ...settings.savedStyles.map((style) => ({
                  style,
                  location: '저장 매대',
                  device: '공용',
                  current: false,
                })),
              ]
                .filter((item) => !item.current)
                .map(({ style, location, device }, index) => (
                  <tr key={`${style.id}-${index}`}>
                    <td>{location}</td>
                    <td>{style.name}</td>
                    <td>{device}</td>
                    <td>
                      <button
                        className="ts-button"
                        onClick={() => {
                          setImportOpen(false);
                          ask({
                            text: '현재 스타일을 선택한 스타일로 덮어쓰시겠습니까?',
                            run: () => {
                              changeLayout((item) =>
                                Object.assign(item, structuredClone(style), {
                                  id: item.id,
                                })
                              );
                              setSelected('container');
                              saleToast('스타일을 가져왔습니다.');
                            },
                          });
                        }}
                      >
                        선택
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </TimeSaleDialog>
      <TimeSaleHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
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

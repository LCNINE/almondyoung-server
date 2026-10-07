'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
import { SaleRenderer, type SaleProduct } from '@packages/time-sale-ui';
import './time-sale-workspace.css';

export const saleToast = (message: string, error = false) =>
  toast[error ? 'error' : 'success'](message, {
    className: error ? 'time-sale-toast-error' : 'time-sale-toast-success',
    position: 'bottom-right',
  });

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

const optionAppliesTo = (type: SaleComponent['type'], key: string) => {
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
            <input
              type={
                key === 'color' || key === 'backgroundColor' ? 'color' : 'text'
              }
              value={value[key] ?? cssFieldDefault(key)}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value) next[key] = e.target.value;
                else delete next[key];
                onChange(next);
              }}
            />
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
    [width, setWidth] = useState(375);

  const [confirmation, setConfirmation] = useState<{
      text: string;
      run: () => void;
      reset?: boolean;
    } | null>(null),
    [resetText, setResetText] = useState('');

  const [variableName, setVariableName] = useState(''),
    [variableDescription, setVariableDescription] = useState(''),
    [variablePreview, setVariablePreview] = useState(''),
    [editingVariable, setEditingVariable] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && !dirty) {
      setSettings(structuredClone(query.data.settings));
      setRevision(query.data.revision);
    }
  }, [query.data, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = (run: (s: TimeSaleSettings) => void) => {
    if (!settings) return;
    const next = structuredClone(settings);
    run(next);
    setSettings(next);
    setDirty(true);
  };

  const save = async (
    message = '타임세일 스타일 변경 사항을 저장하였습니다.'
  ) => {
    if (!settings) return;

    try {
      validateTimeSaleSettings(settings);

      setSaving(true);
      const result = await medusaTimeSaleSettingsApi.save(settings, revision);

      setRevision(result.revision);
      setSettings(result.settings);
      setDirty(false);

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

  const changeLayout = (run: (l: NonNullable<typeof layout>) => void) =>
    update((s) => run(s.styles[surface][platform]));

  const changeComponent = (run: (c: SaleComponent) => void) =>
    changeLayout((l) => {
      const c = l.components.find((c) => c.id === selected);
      if (c) run(c);
    });

  const switchSection = (next: keyof typeof sections) => {
    setSection(next);
    setSelected('container');
  };

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
                    membershipPriceOnly: '비회원에게 멤버십 가격 숨김',
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
                          setConfirmation({
                            text: `${v.name} 변수를 삭제하시겠습니까?`,
                            run: () =>
                              update((s) => {
                                s.variables = s.variables.filter(
                                  (x) => x.name !== v.name
                                );
                                for (const d of Object.values(s.sales))
                                  delete d.variables[v.name];
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
                  onChange={(e) => setState(e.target.value as SalePreviewState)}
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
                      onChange={() => {
                        setPlatform(p);
                        setWidth(p === 'mobile' ? 375 : 1000);
                        setSelected('container');
                      }}
                    />{' '}
                    {p === 'mobile' ? '모바일' : 'PC'}
                  </label>
                ))}
                <button
                  aria-label="프리뷰 새로고침"
                  onClick={() => setRefresh((v) => v + 1)}
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
                        const copy = structuredClone(layout);
                        copy.id = `style-${Date.now()}`;

                        update((s) => s.savedStyles.push(copy));
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
                          setConfirmation({
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
                        setConfirmation({
                          text: '초기화 입력 후 현재 스타일을 기본값으로 되돌립니다.',
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
                        !settings.savedStyles.some((l) => l.id === layout.id)
                      }
                      onClick={() =>
                        setConfirmation({
                          text: '저장된 스타일을 삭제하시겠습니까?',
                          run: () =>
                            update((s) => {
                              s.savedStyles = s.savedStyles.filter(
                                (l) => l.id !== layout.id
                              );
                            }),
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
                            setConfirmation({
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
                      if (
                        layout.components.length >= 15 ||
                        ((type === 'carousel' || type === 'grid') &&
                          layout.components.some(
                            (c) => c.type === 'carousel' || c.type === 'grid'
                          ))
                      ) {
                        saleToast(
                          '컴포넌트는 최대 15개, 상품 매대는 하나까지 추가할 수 있습니다.',
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
                      <option key={key} value={key}>
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
                        <CssEditor
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
      {confirmation && (
        <div className="ts-dialog-veil">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ts-confirm-heading"
            className="ts-dialog"
          >
            <h2 id="ts-confirm-heading">확인</h2>
            <p>{confirmation.text}</p>
            {confirmation.reset && (
              <input
                autoFocus
                aria-label="초기화 확인"
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
              />
            )}
            <div>
              <button
                onClick={() => {
                  setConfirmation(null);
                  setResetText('');
                }}
              >
                아니오
              </button>
              <button
                disabled={confirmation.reset && resetText !== '초기화'}
                onClick={() => {
                  confirmation.run();

                  setConfirmation(null);
                  setResetText('');
                }}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

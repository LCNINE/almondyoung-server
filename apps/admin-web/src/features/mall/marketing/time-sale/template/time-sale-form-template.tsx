'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  defaultSaleDisplay,
  saleLayoutFor,
  repeatTooShortFor,
  type SaleDisplay,
  type SaleProductAction,
  type SalePeriodMode,
} from '@packages/domain-types/time-sale';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import {
  saleToast,
  TimeSaleWorkspace,
} from '../components/time-sale-workspace';
import {
  TimeSaleDialog,
  TimeSaleSwitch,
  TimeSaleOrderButtons,
  TimeSaleExplanation,
} from '../components/time-sale-dialog';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  deriveTimeSaleListStatus,
  TIME_SALE_LIST_STATUS_LABEL,
} from '../time-sale-model';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  TimeSaleValidationError,
  useCreateTimeSale,
  useTimeSaleDetail,
  useTimeSaleProductRows,
  useUpdateTimeSale,
} from '@/lib/services/time-sale';
import {
  moveSelectedItems,
  shortSaleNumber,
  applySavedSalePrices,
  summarizeSaleRows,
  validateRows,
  type TimeSaleRow,
} from '../time-sale-model';
import { TimeSaleProductPicker } from '../components/time-sale-product-picker';

const TIME_SALE_LIST_PATH = '/mall/marketing/time-sale';

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '').replace(
  /\/+$/,
  ''
);

const STOREFRONT_COUNTRY =
  process.env.NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY ?? 'kr';

/** `datetime-local` 은 로컬 시각 문자열만 받는다. ISO 를 그대로 넣으면 값이 안 붙는다. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

type ProductPeriodInput = { startsAt: string; endsAt: string };

function SaleField({
  label,
  children,
  hint,
  explanation,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  explanation?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <fieldset className="ts-form-field">
        <legend>
          {label}
          {explanation && (
            <TimeSaleExplanation label={label}>
              {explanation}
            </TimeSaleExplanation>
          )}
        </legend>
        {children}
      </fieldset>
      {hint && <p className="ts-field-hint">└ {hint}</p>}
    </div>
  );
}

/** 등록과 수정이 같은 화면이다 — 입력·검증·미리보기가 전부 같아 갈라두면 한쪽만 고쳐진다. */
export default function TimeSaleFormTemplate({
  generalId,
  mode = 'settings',
  onClose,
}: {
  generalId?: string;
  mode?: 'settings' | 'products';
  onClose?: () => void;
}) {
  const router = useRouter();

  const isEdit = Boolean(generalId);

  const close = () => (onClose ? onClose() : router.push(TIME_SALE_LIST_PATH));

  const [productsOpen, setProductsOpen] = useState(mode === 'products');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [relatedParent, setRelatedParent] = useState<string | null>(null);
  const [pickingRelated, setPickingRelated] = useState(false);
  const [selectedRelated, setSelectedRelated] = useState<string[]>([]);
  const [savingRelated, setSavingRelated] = useState(false);
  const [unknownStockOnly, setUnknownStockOnly] = useState(false);
  const [dummyStockMode, setDummyStockMode] = useState(
    process.env.NODE_ENV === 'development' ? 'available' : 'off'
  );
  const [pickerIds, setPickerIds] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [priceProductId, setPriceProductId] = useState<string | null>(null);
  const [stylePicker, setStylePicker] = useState<{
    surface: 'main' | 'more' | 'detail';
    platform: 'mobile' | 'pc';
  } | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['time-sale-settings'],
    queryFn: medusaTimeSaleSettingsApi.get,
  });

  // 1) 설정(환경·노출) 조회. 환경설정이나 이 세일이
  // 가격 공개 제한이면 privatePrice 로 화면에 안내한다.
  const [display, setDisplay] = useState<SaleDisplay>(defaultSaleDisplay);

  const privatePrice =
    !!settingsQuery.data?.settings.environment.membershipPriceOnly ||
    display.membershipPriceOnly;

  const repeatDuration = [
    display.repeatHours >= 24
      ? `${Math.floor(display.repeatHours / 24)}일`
      : '',
    display.repeatHours % 24 ? `${display.repeatHours % 24}시간` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const [displayRestored, setDisplayRestored] = useState(false);
  const [promotionId, setPromotionId] = useState('');

  useEffect(() => {
    if (!isEdit) {
      setPromotionId(crypto.randomUUID().replaceAll('-', '').slice(0, 10));
    }
  }, [isEdit]);

  const { data: detail, isLoading: loadingDetail } = useTimeSaleDetail(
    generalId ?? null
  );

  // 편집 진입 시 저장된 노출 설정을 한 번만 채운다.
  useEffect(() => {
    if (detail && settingsQuery.data && !displayRestored) {
      setDisplay(
        settingsQuery.data.settings.sales[detail.saleId] ?? defaultSaleDisplay()
      );
      setDisplayRestored(true);
    }
  }, [detail, settingsQuery.data, displayRestored]);

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInput(new Date().toISOString())
  );

  const [endsAt, setEndsAt] = useState(() =>
    toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString())
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<TimeSaleRow[]>([]);
  const [restored, setRestored] = useState(false);
  const [periodMode, setPeriodMode] = useState<SalePeriodMode>('sale');
  const [productPeriods, setProductPeriods] = useState<
    Record<string, ProductPeriodInput>
  >({});

  const {
    data: loadedRows,
    isFetching,
    refetch: refetchProducts,
  } = useTimeSaleProductRows(selectedIds);

  const relatedIds = relatedParent
    ? (display.productActions?.[relatedParent]?.related ?? []).map(
        (item) => item.productId
      )
    : [];

  const { data: relatedRows, refetch: refetchRelated } =
    useTimeSaleProductRows(relatedIds);

  const createTimeSale = useCreateTimeSale();

  const updateTimeSale = useUpdateTimeSale();

  // 편집 진입 시 한 번만 채운다. 이후엔 사용자의 입력이 이긴다.
  useEffect(() => {
    if (!detail || !settingsQuery.data || restored) return;

    setTitle(detail.title);
    setStartsAt(toLocalInput(detail.period.startsAt));
    setEndsAt(toLocalInput(detail.period.endsAt));

    const order =
      settingsQuery.data?.settings.sales[detail.saleId]?.productOrder ?? [];
    setSelectedIds([
      ...new Set([
        ...order.filter((id) => detail.productIds.includes(id)),
        ...detail.productIds,
      ]),
    ]);
    setPeriodMode(detail.periodMode);
    setProductPeriods(
      Object.fromEntries(
        Object.entries(detail.productPeriods).map(([productId, period]) => [
          productId,
          {
            startsAt: period.startsAt ? toLocalInput(period.startsAt) : '',
            endsAt: period.endsAt ? toLocalInput(period.endsAt) : '',
          },
        ])
      )
    );
    setRestored(true);
  }, [detail, restored, settingsQuery.data]);

  // 저장돼 있던 세일가를 편집 행에 얹는다. 정가·멤버십가는 상품 응답의 현재 값을 쓴다.
  const [pricesApplied, setPricesApplied] = useState(false);

  useEffect(() => {
    if (!detail || !loadedRows || !settingsQuery.data || pricesApplied) return;

    setRows(applySavedSalePrices(loadedRows, detail.savedPrices));
    setPricesApplied(true);
  }, [detail, loadedRows, pricesApplied, settingsQuery.data]);

  // 상품 목록이 바뀌면 이미 입력한 세일가는 유지하고 새 품목만 붙인다.
  const mergedRows = useMemo(() => {
    if (!loadedRows) return [];

    const edited = new Map(rows.map((row) => [row.variantId, row]));

    return loadedRows.map((row) => {
      const previous = edited.get(row.variantId);

      return previous
        ? {
            ...row,
            generalSalePrice: previous.generalSalePrice,
            membershipSalePrice: previous.membershipSalePrice,
          }
        : row;
    });
  }, [loadedRows, rows]);

  // Existing prices may follow an older policy. Editing dates must not force a price change.
  const pricesUnchanged =
    !!detail &&
    selectedIds.length === detail.productIds.length &&
    selectedIds.every((id) => detail.productIds.includes(id)) &&
    privatePrice ===
      (!!settingsQuery.data?.settings.environment.membershipPriceOnly ||
        !!settingsQuery.data?.settings.sales[detail.saleId]
          ?.membershipPriceOnly) &&
    mergedRows.every(
      (row) =>
        row.generalSalePrice ===
          (detail.savedPrices.general.get(row.variantId) ?? null) &&
        row.membershipSalePrice ===
          (detail.savedPrices.membership.get(row.variantId) ?? null)
    );

  const savedDisplay = detail
    ? (settingsQuery.data?.settings.sales[detail.saleId] ??
      defaultSaleDisplay())
    : null;

  const formChanged =
    !!detail &&
    (!pricesUnchanged ||
      title.trim() !== detail.title ||
      startsAt !== toLocalInput(detail.period.startsAt) ||
      endsAt !== toLocalInput(detail.period.endsAt) ||
      JSON.stringify(display) !== JSON.stringify(savedDisplay) ||
      (periodMode === 'product' &&
        Object.entries(productPeriods).some(([id, period]) => {
          const saved = detail.productPeriods[id];

          return (
            !saved ||
            period.startsAt !==
              (saved.startsAt ? toLocalInput(saved.startsAt) : '') ||
            period.endsAt !== (saved.endsAt ? toLocalInput(saved.endsAt) : '')
          );
        })));

  const errors = pricesUnchanged ? [] : validateRows(mergedRows, privatePrice);

  const saleSummary = summarizeSaleRows(
    privatePrice
      ? mergedRows.map((row) => ({
          ...row,
          basePrice: row.membershipBasePrice ?? row.basePrice,
          generalSalePrice: row.membershipSalePrice,
        }))
      : mergedRows
  );

  const editPrice = (
    variantId: string,
    field: 'generalSalePrice' | 'membershipSalePrice',
    value: string
  ) => {
    setRows(
      mergedRows.map((row) =>
        row.variantId === variantId
          ? { ...row, [field]: value === '' ? null : Number(value) }
          : row
      )
    );
  };

  const audienceFields = (
    <fieldset className="ts-audience">
      <legend>누구에게 할인할까요?</legend>
      <div className="ts-inline">
        <label>
          <input
            type="radio"
            name="sale-audience"
            checked={!privatePrice}
            disabled={
              !!settingsQuery.data?.settings.environment.membershipPriceOnly
            }
            onChange={() =>
              setDisplay((previous) => ({
                ...previous,
                membershipPriceOnly: false,
              }))
            }
          />{' '}
          전체 고객 할인
        </label>
        <label>
          <input
            type="radio"
            name="sale-audience"
            checked={privatePrice}
            onChange={() =>
              setDisplay((previous) => ({
                ...previous,
                membershipPriceOnly: true,
              }))
            }
          />{' '}
          멤버십 회원만 할인
        </label>
      </div>
      <p>
        {privatePrice
          ? '일반 고객에게는 기존 가격으로 판매합니다. 멤버십 회원에게만 설정한 기간 동안 할인합니다. 할인 금액은 멤버십 회원에게만 보여줍니다.'
          : '모든 고객에게 일반 세일가를 적용합니다. 멤버십 추가 할인은 선택이며, 비우면 일반 세일가와 기존 멤버십가 중 더 싼 가격을 적용합니다.'}
      </p>
    </fieldset>
  );

  const isPending = createTimeSale.isPending || updateTimeSale.isPending;

  // 저장: 1) 입력 검증(이름·기간·품목·세일가) 2) 기간 최소 길이·반복
  // 간격 검사 3) 상품별 기간 ISO 변환 4) 등록/수정 호출 후 목록으로 이동.
  const submit = async () => {
    if (!title.trim() || !startsAt || !endsAt) {
      toast.error('세일 이름과 기간을 입력하세요.');
      return;
    }
    if (new Date(startsAt) >= new Date(endsAt)) {
      toast.error('종료 시각이 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (mergedRows.length === 0) {
      toast.error('세일에 올릴 상품을 선택하세요.');
      return;
    }
    if (saleSummary.filled === 0) {
      toast.error('세일가를 입력한 품목이 하나도 없습니다.');
      return;
    }

    const durationMs =
      new Date(endsAt).getTime() - new Date(startsAt).getTime();

    // 정책: 타임세일 최소 길이 5분.
    if (durationMs < 300000) {
      saleToast('타임세일은 5분 이상이어야 합니다.', true);
      return;
    }

    const period = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };

    const resolvedProductPeriods = Object.fromEntries(
      Object.entries(productPeriods).map(([productId, input]) => [
        productId,
        {
          startsAt: input.startsAt
            ? new Date(input.startsAt).toISOString()
            : period.startsAt,
          endsAt: input.endsAt
            ? new Date(input.endsAt).toISOString()
            : period.endsAt,
        },
      ])
    );

    const repeatPeriods =
      periodMode === 'product'
        ? [...new Set(mergedRows.map((row) => row.productId))].map(
            (productId) => resolvedProductPeriods[productId] ?? period
          )
        : [period];

    // 정책: 반복 간격은 기간보다 10분 이상 길어야 한다(서버 검증과 같은 규칙).
    if (repeatTooShortFor(display.repeatHours, repeatPeriods)) {
      saleToast(
        periodMode === 'product'
          ? '반복 간격은 각 상품 기간보다 10분 이상 길어야 합니다.'
          : '반복 간격은 세일 기간보다 10분 이상 길어야 합니다.',
        true
      );
      return;
    }

    // 세일에서 뺀 상품의 변수 값은 같이 정리한다(설정 크기 상한 보호).
    const savedDisplay: SaleDisplay = {
      ...display,
      webId: display.webId || promotionId,
      productOrder: selectedIds,
      productActions: Object.fromEntries(
        Object.entries(display.productActions ?? {}).filter(([productId]) =>
          selectedIds.includes(productId)
        )
      ),
      productVariables: Object.fromEntries(
        Object.entries(display.productVariables ?? {}).filter(([id]) =>
          selectedIds.includes(id)
        )
      ),
    };

    try {
      if (isEdit && detail) {
        await updateTimeSale.mutateAsync({
          saleId: detail.saleId,
          generalId: detail.generalId,
          membershipId: detail.membershipId,
          title: title.trim(),
          period,
          rows: mergedRows,
          preservePrices: pricesUnchanged,
          display: savedDisplay,
          periodMode,
          productPeriods: resolvedProductPeriods,
        });
        saleToast('타임세일을 수정하였습니다.');
      } else {
        await createTimeSale.mutateAsync({
          title: title.trim(),
          period,
          rows: mergedRows,
          display: savedDisplay,
          periodMode,
          productPeriods: resolvedProductPeriods,
        });
        saleToast('신규 타임세일을 생성하였습니다.');
      }
      close();
    } catch (error) {
      toast.error(
        error instanceof TimeSaleValidationError
          ? error.message
          : isEdit
            ? '타임세일 수정에 실패했습니다.'
            : '타임세일 등록에 실패했습니다.'
      );
    }
  };

  const patchDisplay = (patch: Partial<SaleDisplay>) =>
    setDisplay((prev) => ({ ...prev, ...patch }));

  const patchProductAction = (
    productId: string,
    patch: Partial<SaleProductAction>
  ) => {
    setDisplay((previous) => ({
      ...previous,
      productActions: {
        ...previous.productActions,
        [productId]: { ...previous.productActions?.[productId], ...patch },
      },
    }));
  };

  const saveRelated = async () => {
    if (!relatedParent) return;

    if (!detail || !settingsQuery.data) {
      setRelatedParent(null);
      return;
    }

    setSavingRelated(true);

    try {
      const { settings, revision } = settingsQuery.data;
      const sale = settings.sales[detail.saleId] ?? defaultSaleDisplay();
      const related = display.productActions?.[relatedParent]?.related ?? [];

      await medusaTimeSaleSettingsApi.save(
        {
          ...settings,
          sales: {
            ...settings.sales,
            [detail.saleId]: {
              ...sale,
              productActions: {
                ...sale.productActions,
                [relatedParent]: {
                  ...sale.productActions?.[relatedParent],
                  related,
                },
              },
            },
          },
        },
        revision
      );

      await settingsQuery.refetch();
      await refetchProducts();
      await refetchRelated();
      setRelatedParent(null);
      saleToast('전/후처리 연관 상품 설정을 저장하였습니다.');
    } catch {
      saleToast('연관 상품 설정을 저장하지 못했습니다. 다시 시도하세요.', true);
    } finally {
      setSavingRelated(false);
    }
  };

  const ready =
    !isPending &&
    !isFetching &&
    !loadingDetail &&
    (!isEdit || (restored && pricesApplied && displayRestored)) &&
    errors.length === 0;

  const settingsTitle = isEdit
    ? `타임 세일 수정 [타임세일번호 : ${shortSaleNumber(detail?.saleId ?? '')}]`
    : '신규 타임 세일';

  const closeProducts = () =>
    mode === 'products' ? close() : setProductsOpen(false);

  const patchStyle = (
    surface: 'main' | 'more' | 'detail',
    platform: 'mobile' | 'pc',
    patch: { styleId?: string; enabled?: boolean }
  ) => {
    setDisplay((prev) => ({
      ...prev,
      styles: {
        ...prev.styles,
        [surface]: {
          ...prev.styles?.[surface],
          [platform]: {
            styleId: '',
            enabled: true,
            ...prev.styles?.[surface]?.[platform],
            ...patch,
          },
        },
      },
    }));
  };

  const styleLabels = {
    main: '메인 매대',
    more: '더보기 매대',
    detail: '상품상세',
  };

  const saleStatus = detail
    ? deriveTimeSaleListStatus(
        {
          status: detail.status,
          priceListIds: [detail.generalId, detail.membershipId].filter(
            (id): id is string => !!id
          ),
          periods: [detail.period],
        },
        settingsQuery.data?.settings.environment ?? {
          enabled: true,
          suspendedPriceListIds: [],
        },
        new Date()
      )
    : 'stopped';

  const [statusText, statusDetail] =
    TIME_SALE_LIST_STATUS_LABEL[saleStatus].split('(');

  const selectedRows = [
    ...new Map(mergedRows.map((row) => [row.productId, row])).values(),
  ];

  const stockOf = (productId: string): number | null => {
    if (process.env.NODE_ENV !== 'development' || dummyStockMode === 'off')
      return null;

    if (dummyStockMode === 'available') return 12;

    if (dummyStockMode === 'sold-out') return 0;

    const index = selectedIds.indexOf(productId);

    return index % 3 === 0 ? 12 : index % 3 === 1 ? 0 : null;
  };

  const unknownStockCount = selectedRows.filter(
    (row) => stockOf(row.productId) === null
  ).length;

  const visibleRows = unknownStockOnly
    ? selectedRows.filter((row) => stockOf(row.productId) === null)
    : selectedRows;

  const dialogs = (
    <>
      <TimeSaleDialog
        open={mode === 'settings'}
        title={settingsTitle}
        onClose={close}
        footer={
          <button
            className="ts-button"
            disabled={
              isPending ||
              isFetching ||
              loadingDetail ||
              !title.trim() ||
              (isEdit &&
                (!restored ||
                  !pricesApplied ||
                  !displayRestored ||
                  !formChanged))
            }
            onClick={() =>
              mergedRows.length && saleSummary.filled && errors.length === 0
                ? void submit()
                : setProductsOpen(true)
            }
          >
            {isPending
              ? '저장 중…'
              : !saleSummary.filled || errors.length
                ? '상품·가격 설정'
                : isEdit
                  ? '수정'
                  : '생성'}
          </button>
        }
      >
        {isEdit && loadingDetail ? (
          <p>불러오는 중…</p>
        ) : isEdit && !detail ? (
          <p role="alert">타임세일을 찾을 수 없습니다.</p>
        ) : (
          <div className="ts-form-grid">
            <SaleField label="명칭*" className="ts-span-all">
              <Input
                aria-label="명칭"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </SaleField>
            <SaleField
              label="파티션ID (옵션) / 기본은 입력하지 않습니다."
              hint="home-sale: 기본 홈 구역 / home-top: 홈 상단 구역.(최대:10자)"
              explanation="세일과 쇼핑몰의 출력 구역을 연결하는 이름입니다. 비워 두거나 home-sale을 입력하면 홈 타임세일 구역에 표시됩니다. home-top은 홈 상단에 표시됩니다. 다른 이름은 코드에서 같은 파티션ID로 연결한 구역에 표시됩니다."
            >
              <Input
                aria-label="파티션ID"
                maxLength={10}
                value={display.partitionId}
                onChange={(event) =>
                  patchDisplay({ partitionId: event.target.value })
                }
              />
            </SaleField>
            <SaleField
              label="GA4 프로모션ID"
              hint="신규 등록 시 자동으로 입력됩니다. 현재 쇼핑몰에 연결된 GA4에서 이 ID로 노출과 클릭을 구분합니다."
              explanation="현재 쇼핑몰의 GA4로 타임세일 노출과 클릭을 전송합니다. 분석에서 세일을 구분할 이름이며, G-로 시작하는 GA4 측정ID를 입력하는 칸은 아닙니다."
            >
              <Input
                aria-label="GA4 프로모션ID"
                maxLength={10}
                value={display.webId || detail?.saleId || promotionId}
                placeholder="프로모션 ID 자동 생성"
                onChange={(event) =>
                  patchDisplay({ webId: event.target.value })
                }
              />
            </SaleField>
            <SaleField
              label="상품별 기간 구분"
              hint={
                isEdit
                  ? '수정이 불가합니다.'
                  : '신규 타임 세일을 생성할 때만 설정이 가능하며 이후 수정이 불가합니다.'
              }
            >
              <select
                aria-label="상품별 기간 구분"
                value={periodMode}
                disabled={isEdit}
                onChange={(event) =>
                  setPeriodMode(event.target.value as SalePeriodMode)
                }
              >
                <option value="sale">상품별 단일 할인 기간</option>
                <option value="product">상품별 개별 할인 기간</option>
              </select>
            </SaleField>
            <SaleField
              label="품절 상품 표시"
              hint="확인된 품절 상품을 매대에 표시할지 설정합니다. 재고 확인 불가 상품은 품절로 취급하지 않습니다."
              explanation="품절이 확인된 상품에만 적용합니다. 재고 정보가 없어 '-'로 표시된 상품에는 적용하지 않습니다."
            >
              <TimeSaleSwitch
                label="품절 상품 표시"
                checked={display.showSoldOut}
                onChange={(showSoldOut) => patchDisplay({ showSoldOut })}
              />
            </SaleField>
            <SaleField
              label="기간"
              className="ts-span-all"
              hint="5분 이상 차이가 나도록 설정해 주세요."
            >
              <div className="ts-period-inputs">
                <Input
                  aria-label="시작"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
                <span>~</span>
                <Input
                  aria-label="종료"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </SaleField>
            <SaleField
              label="SHIFT 반복"
              className="ts-span-all"
              explanation="시작·종료 시간을 같은 간격만큼 옮겨 반복합니다. 오늘 13:00~14:00 세일에 24시간을 설정하면 내일도 13:00~14:00에 진행됩니다. 만료기준시간이 없으면 계속 반복합니다."
              hint="타임세일 종료 이후에 지정한 시간 만큼 시작/종료 시간에 추가하여 만료기준시간 직전 회차까지 반복 활성화합니다. 만료기준시간을 설정하지 않으면 무한 반복합니다."
            >
              <TimeSaleSwitch
                label="SHIFT 반복"
                checked={display.repeatHours > 0}
                onChange={(enabled) =>
                  patchDisplay({ repeatHours: enabled ? 24 : 0 })
                }
              />
              {display.repeatHours > 0 && (
                <div className="ts-repeat-options">
                  <span>추가 시간: {repeatDuration}</span>
                  <div className="ts-repeat-slider">
                    <input
                      aria-label="반복 주기(시간)"
                      type="range"
                      min="1"
                      max="336"
                      value={display.repeatHours}
                      style={{
                        background: `linear-gradient(to right, #3478ce ${((display.repeatHours - 1) / 335) * 100}%, #b5c9e7 ${((display.repeatHours - 1) / 335) * 100}%)`,
                      }}
                      onChange={(event) =>
                        patchDisplay({
                          repeatHours: Number(event.target.value),
                        })
                      }
                    />
                    <div className="ts-repeat-marks">
                      {Array.from({ length: 15 }, (_, day) => (
                        <span key={day}>{day ? `${day}일` : '1시간'}</span>
                      ))}
                    </div>
                  </div>
                  <label htmlFor="ts-repeat-until">만료기준시간</label>
                  <div className="ts-repeat-expiry">
                    <Input
                      id="ts-repeat-until"
                      aria-label="만료기준시간"
                      type="datetime-local"
                      value={
                        display.repeatUntil
                          ? toLocalInput(display.repeatUntil)
                          : ''
                      }
                      onChange={(event) =>
                        patchDisplay({
                          repeatUntil: event.target.value
                            ? new Date(event.target.value).toISOString()
                            : null,
                        })
                      }
                    />
                    <button
                      type="button"
                      className="ts-icon-button"
                      aria-label="만료기준시간 지우기"
                      onClick={() => patchDisplay({ repeatUntil: null })}
                    >
                      ×
                    </button>
                    <small>
                      {display.repeatUntil
                        ? '만료기준시간 전에 끝나는 회차까지만 반복합니다.'
                        : '만료기준시간 없이 계속 반복합니다.'}
                    </small>
                  </div>
                </div>
              )}
            </SaleField>
            <div className="ts-form-thirds ts-span-all">
              <SaleField
                label="전시모드"
                hint="모든 상품상세페이지에 상품상세스타일을 표시."
              >
                <TimeSaleSwitch
                  label="전시모드"
                  checked={display.detail && !display.main && !display.more}
                  onChange={(enabled) =>
                    patchDisplay({
                      detail: true,
                      main: !enabled,
                      more: !enabled,
                    })
                  }
                />
              </SaleField>
              <SaleField label="예정 활성" hint="시작 전 타임세일을 예정 표시.">
                <TimeSaleSwitch
                  label="예정 활성"
                  checked={display.showScheduled}
                  onChange={(showScheduled) => patchDisplay({ showScheduled })}
                />
              </SaleField>
              <SaleField
                label="마감 활성"
                hint="중지 상태의 타임세일을 마감 표시."
              >
                <TimeSaleSwitch
                  label="마감 활성"
                  checked={display.showEnded}
                  onChange={(showEnded) => patchDisplay({ showEnded })}
                />
              </SaleField>
            </div>
            {(['mobile', 'pc'] as const).map((platform) => (
              <SaleField
                key={platform}
                label={`${platform === 'mobile' ? '모바일' : 'PC'} 진열매대 스타일`}
              >
                {(['main', 'more', 'detail'] as const).map((surface) => (
                  <div className="ts-style-selection" key={surface}>
                    <span>
                      {styleLabels[surface]}:{' '}
                      {settingsQuery.data
                        ? saleLayoutFor(
                            settingsQuery.data.settings,
                            display,
                            surface,
                            platform
                          ).name
                        : '기본'}
                    </span>
                    <TimeSaleSwitch
                      label={`${platform} ${styleLabels[surface]} 활성`}
                      checked={
                        display[surface] &&
                        display.styles?.[surface]?.[platform]?.enabled !== false
                      }
                      onChange={(enabled) =>
                        patchStyle(surface, platform, { enabled })
                      }
                    />
                    <span className="ts-enabled-text">
                      {display[surface] &&
                      display.styles?.[surface]?.[platform]?.enabled !== false
                        ? '활성'
                        : '중지'}
                    </span>
                    <button
                      type="button"
                      className="ts-button"
                      onClick={() => setStylePicker({ surface, platform })}
                    >
                      선택
                    </button>
                  </div>
                ))}
              </SaleField>
            ))}
            <div className="ts-span-all">{audienceFields}</div>
          </div>
        )}
      </TimeSaleDialog>
      <TimeSaleDialog
        open={productsOpen}
        wide
        title={
          <>
            <span>상품진열 </span>
            <span className="ts-blue">
              [{shortSaleNumber(detail?.saleId ?? '')} :{' '}
              {periodMode === 'product' ? '개별 할인 기간' : '단일 할인 기간'} :{' '}
              {title}]
            </span>
          </>
        }
        onClose={closeProducts}
        footer={
          <button
            className="ts-button ts-button-neutral"
            disabled={
              !ready ||
              mergedRows.length === 0 ||
              saleSummary.filled === 0 ||
              (isEdit && !formChanged)
            }
            onClick={() => void submit()}
          >
            {isPending ? '저장 중…' : isEdit ? '적용' : '생성'}
          </button>
        }
      >
        {audienceFields}
        <div className="ts-product-notices">
          <details>
            <summary>안내 및 주의 사항</summary>
            <ul>
              <li>
                <strong>진열·판매의 예 / 아니오:</strong> 현재 쇼핑몰 상품의
                상태입니다. 아래 체크박스는 세일 실행·중지 때 적용할 설정이며,
                체크만 바꿔서는 현재 상태가 바뀌지 않습니다.
              </li>
              <li>
                <strong>실행:On만 체크:</strong> 세일이 시작되면 상품을
                진열하거나 판매 가능하게 합니다. 중지:Off를 체크하지 않으면
                세일이 중지·종료되어도 자동으로 끄지 않습니다. 할인은 끝나고
                상품은 일반 가격으로 계속 진열·판매됩니다.
              </li>
              <li>
                <strong>실행:On과 중지:Off를 모두 체크:</strong> 세일 중에는
                진열·판매하고, 세일이 중지·종료되면 해당 항목을 끕니다. 진열
                칸에 설정하면 상품을 숨기고, 판매 칸에 설정하면 구매할 수 없게
                합니다. 중지:Off는 지금 즉시 끄는 버튼이 아닙니다.
              </li>
              <li>
                설정을 바꾼 뒤 아래 <strong>적용</strong> 버튼으로 저장하세요.
                서비스 켜짐과 개별 세일의 실행·중지는 별개입니다. 실행:On은
                서비스가 켜져 있고 세일이 할인 기간에 실행될 때 적용됩니다.
              </li>
              <li>
                타임세일 기간에는 기간 판매가를 적용하며 종료 이후에는 원래
                판매가로 복원됩니다.
              </li>
              <li>
                실행중인 타임세일의 상품을 수정하면 쇼핑몰 가격에 반영됩니다.
              </li>
              <li className="ts-notice-important">
                다른 세일에 이미 포함된 상품은 선택할 수 없습니다.
              </li>
            </ul>
          </details>
          <details>
            <summary>용어 설명</summary>
            <ul>
              <li>
                <strong>최초 판매가:</strong> 상품의 현재 일반 판매가입니다.
              </li>
              <li>
                <strong>기간 판매가:</strong> 타임세일 기간에 적용할 가격입니다.
              </li>
              <li className="ts-notice-important">
                <strong>판매가 자동갱신:</strong> 켜면 할인 기간에 기간 판매가를
                적용합니다. 끄면 일반 판매가를 적용합니다. 일반 가격 자체는
                덮어쓰지 않습니다.
              </li>
              <li>
                <strong>복원판매가:</strong> 타임세일이 끝났을 때 돌아갈 일반
                판매가입니다. 예를 들어 평소 10,000원, 세일가 8,000원이면 종료
                후 10,000원으로 돌아갑니다. 우리 Medusa는 일반 가격을 덮어쓰지
                않고 기간 할인 가격표를 적용합니다. 그래서 종료 후에는 당시의
                일반 가격이 다시 적용됩니다. 세일 도중 일반 가격을 바꾸면 그
                변경된 가격으로 돌아갑니다.
              </li>
              <li>
                <strong>품절:</strong> 판매 가능한 재고가 없는 상태입니다. '-'는
                품절이 아니라 재고 정보를 확인하지 못했다는 뜻입니다.
              </li>
              <li>
                <strong>전/후처리:</strong> 연관 상품에 실행:Off를 체크하면 세일
                실행 때 진열 또는 판매를 끕니다. 중지:On을 체크하면 세일
                중지·종료 때 다시 켭니다. 중지:On을 선택하면 실행:Off도 자동
                선택되어 잠깁니다. 숫자는 연결된 상품 수입니다. 연관 상품에는
                할인 가격이 적용되지 않으며 타임세일 매대에도 추가되지 않습니다.
                할인·매대 표시가 필요하면 상품 추가에서 별도로 등록하세요.
                설정은 상품진열의 적용 버튼으로 저장합니다.
              </li>
              <li>
                <strong>멤버십 판매가:</strong> 멤버십 회원에게 적용할
                가격입니다.
              </li>
            </ul>
          </details>
        </div>
        <div className="ts-stock-notice">
          <button
            type="button"
            className="ts-button"
            aria-pressed={unknownStockOnly}
            onClick={() => setUnknownStockOnly(!unknownStockOnly)}
          >
            {unknownStockOnly
              ? '전체 상품 보기'
              : `재고 확인 불가 ${unknownStockCount}개`}
          </button>
          <span>
            {unknownStockOnly ? '재고 확인 불가 상품만 표시합니다. ' : ''}
            {dummyStockMode === 'off'
              ? '현재 재고 정보가 연결되지 않아 품절 여부를 확인할 수 없습니다.'
              : '확인용 더미 재고입니다. 실제 상품 재고에는 반영되지 않습니다.'}
          </span>
          {process.env.NODE_ENV === 'development' && (
            <label>
              더미 재고{' '}
              <select
                aria-label="확인용 더미 재고"
                value={dummyStockMode}
                onChange={(event) => {
                  setDummyStockMode(event.target.value);
                  setUnknownStockOnly(false);
                }}
              >
                <option value="available">재고 있음 (12개)</option>
                <option value="sold-out">품절 (0개)</option>
                <option value="mixed">재고 있음 / 품절 / 확인 불가</option>
                <option value="off">연결 없음</option>
              </select>
            </label>
          )}
        </div>
        <div className="ts-list-toolbar">
          <TimeSaleOrderButtons
            disabled={!selectedProducts.length}
            onMove={(direction) =>
              setSelectedIds(
                moveSelectedItems(selectedIds, selectedProducts, direction)
              )
            }
          />
          <span className="ts-count">{selectedIds.length} / 60</span>
          <div className="ts-toolbar-spacer" />
          <button
            className="ts-icon-button"
            aria-label="상품 새로고침"
            disabled={isFetching}
            onClick={() => void refetchProducts()}
          >
            <RefreshCw size={21} />
          </button>
          <button
            className="ts-button"
            onClick={() => {
              setPickingRelated(false);
              setPickerIds(selectedIds);
              setPickerOpen(true);
            }}
          >
            <Plus size={16} />
            상품 추가
          </button>
          <button
            className="ts-button ts-button-neutral"
            disabled={!selectedProducts.length}
            onClick={() => {
              setSelectedIds((ids) =>
                ids.filter((id) => !selectedProducts.includes(id))
              );
              setSelectedProducts([]);
            }}
          >
            <Trash2 size={13} />
            삭제
          </button>
        </div>
        <div className="ts-table-scroll">
          <table className="ts-table ts-product-table">
            <colgroup>
              {[
                42, 55, 110, 70, 75, 126, 80, 80, 40, 70, 70, 90, 80, 60, 90,
                90, 60, 70,
              ].map((width, index) => (
                <col
                  key={index}
                  style={{ width: `${(width / 1358) * 100}%` }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="상품 전체 선택"
                    checked={
                      selectedRows.length > 0 &&
                      selectedProducts.length === selectedRows.length
                    }
                    onChange={() =>
                      setSelectedProducts(
                        selectedProducts.length === selectedRows.length
                          ? []
                          : selectedRows.map((row) => row.productId)
                      )
                    }
                  />
                </th>
                <th>진열순위</th>
                <th>
                  상태
                  <br />
                  <small>(브라우저 표시)</small>
                </th>
                <th>상품번호</th>
                <th>상품코드</th>
                <th>상품명</th>
                {(['진열', '판매'] as const).map((attribute) => (
                  <th key={attribute}>
                    {attribute}{' '}
                    <TimeSaleExplanation label={`${attribute} 실행·중지 설정`}>
                      <p>예·아니오는 현재 상품 상태입니다.</p>
                      <p>
                        실행:On만 체크하면 세일 시작 때{' '}
                        {attribute === '진열'
                          ? '상품을 진열하고, 세일 종료 후에도 일반 가격으로 계속 노출합니다.'
                          : '판매를 켜고, 세일 종료 후에도 일반 가격으로 계속 구매할 수 있습니다.'}
                      </p>
                      <p>
                        중지:Off도 체크하면 세일 중지·종료 때{' '}
                        {attribute === '진열'
                          ? '상품을 숨깁니다.'
                          : '구매할 수 없게 합니다.'}{' '}
                        지금 즉시 끄는 버튼은 아닙니다.
                      </p>
                      <p>설정을 바꾼 뒤 적용 버튼으로 저장하세요.</p>
                    </TimeSaleExplanation>
                  </th>
                ))}
                <th>품절</th>
                <th>이미지</th>
                <th>상품상세</th>
                <th>소비자가</th>
                <th>
                  최초
                  <br />
                  판매가
                </th>
                <th>
                  기간
                  <br />
                  할인률
                </th>
                <th>
                  기간
                  <br />
                  판매가
                </th>
                <th>
                  복원
                  <br />
                  판매가
                </th>
                <th>
                  판매가
                  <br />
                  자동갱신
                </th>
                <th>전/후처리</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows
                .sort(
                  (a, b) =>
                    selectedIds.indexOf(a.productId) -
                    selectedIds.indexOf(b.productId)
                )
                .map((row, index) => (
                  <tr key={row.productId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${row.productTitle} 진열 선택`}
                        checked={selectedProducts.includes(row.productId)}
                        onChange={(event) =>
                          setSelectedProducts((ids) =>
                            event.target.checked
                              ? [...ids, row.productId]
                              : ids.filter((id) => id !== row.productId)
                          )
                        }
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td>
                      <span className="ts-status">{statusText}</span>
                      <br />
                      <span className="ts-status-detail">({statusDetail}</span>
                    </td>
                    <td>{row.productId.slice(-8)}</td>
                    <td>{row.productCode || '-'}</td>
                    <td className="ts-name">{row.productTitle}</td>
                    {(['display', 'selling'] as const).map((attribute) => (
                      <td key={attribute}>
                        <span
                          className={
                            (
                              attribute === 'display'
                                ? row.productDisplay
                                : row.productSelling
                            )
                              ? 'ts-product-yes'
                              : 'ts-product-no'
                          }
                        >
                          {(
                            attribute === 'display'
                              ? row.productDisplay
                              : row.productSelling
                          )
                            ? '예'
                            : row.productStatus
                              ? '아니오'
                              : '-'}
                        </span>
                        <div className="ts-product-actions">
                          {(['OnStart', 'OffStop'] as const).map((phase) => {
                            const key = `${attribute}${phase}` as
                              | 'displayOnStart'
                              | 'displayOffStop'
                              | 'sellingOnStart'
                              | 'sellingOffStop';
                            const label =
                              phase === 'OnStart' ? '실행:On' : '중지:Off';

                            return (
                              <label
                                key={phase}
                                title={
                                  phase === 'OnStart'
                                    ? '세일 실행 시 켜기. 체크 후 적용 버튼으로 저장하세요.'
                                    : '세일 중지·종료 시 끄기. 지금 즉시 끄는 버튼이 아닙니다.'
                                }
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`${row.productTitle} ${attribute === 'display' ? '진열' : '판매'} ${label}`}
                                  checked={
                                    display.productActions?.[row.productId]?.[
                                      key
                                    ] ?? false
                                  }
                                  disabled={
                                    phase === 'OnStart' &&
                                    !!display.productActions?.[row.productId]?.[
                                      attribute === 'display'
                                        ? 'displayOffStop'
                                        : 'sellingOffStop'
                                    ]
                                  }
                                  onChange={(event) =>
                                    patchProductAction(row.productId, {
                                      [key]: event.target.checked,
                                      ...(phase === 'OffStop' &&
                                      event.target.checked
                                        ? {
                                            [attribute === 'display'
                                              ? 'displayOnStart'
                                              : 'sellingOnStart']: true,
                                          }
                                        : {}),
                                    })
                                  }
                                />
                                {label}
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    ))}
                    <td>
                      {stockOf(row.productId) === null ? (
                        <>
                          -
                          <TimeSaleExplanation
                            label={`${row.productTitle} 품절 상태`}
                          >
                            재고 정보를 확인하지 못했습니다. 품절로 취급하지
                            않습니다.
                          </TimeSaleExplanation>
                        </>
                      ) : (
                        <span
                          className={
                            stockOf(row.productId) === 0
                              ? 'ts-product-no'
                              : 'ts-product-yes'
                          }
                          title={`확인용 재고 ${stockOf(row.productId)}개`}
                        >
                          {stockOf(row.productId) === 0 ? '예' : '아니오'}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.productThumbnail ? (
                        // 외부 상품 이미지 URL을 그대로 사용하는 관리 화면의 미리보기.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolvePublicFileUrl(row.productThumbnail) ?? ''}
                          alt={row.productTitle}
                          className="ts-product-image"
                        />
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {row.productHandle && STOREFRONT_URL ? (
                        <a
                          className="ts-product-detail-link"
                          aria-label={`${row.productTitle} 상품페이지 새 탭`}
                          href={`${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/products/${encodeURIComponent(row.productHandle)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          상품상세
                        </a>
                      ) : (
                        <span title="쇼핑몰 주소 또는 상품 handle이 없습니다.">
                          -
                        </span>
                      )}
                    </td>
                    <td>-</td>
                    <td>{row.basePrice.toLocaleString('ko-KR')}</td>
                    <td>
                      {(privatePrice
                        ? row.membershipSalePrice
                        : row.generalSalePrice) === null
                        ? '-'
                        : `${Math.round((1 - (privatePrice ? row.membershipSalePrice! : row.generalSalePrice!) / (privatePrice ? (row.membershipBasePrice ?? row.basePrice) : row.basePrice)) * 100)}%`}
                    </td>
                    <td>
                      <div className="ts-price-summary">
                        {mergedRows.filter(
                          (item) => item.productId === row.productId
                        ).length > 1 ? (
                          <small>옵션별 가격 설정</small>
                        ) : (
                          <>
                            <small>
                              일반:{' '}
                              {privatePrice
                                ? '기존 가격 유지'
                                : (row.generalSalePrice?.toLocaleString(
                                    'ko-KR'
                                  ) ?? '할인 제외')}
                            </small>
                            <small>
                              멤버십:{' '}
                              {row.membershipSalePrice?.toLocaleString(
                                'ko-KR'
                              ) ?? (privatePrice ? '할인 제외' : '자동 적용')}
                            </small>
                          </>
                        )}
                        <button
                          className="ts-button"
                          aria-label={`${row.productTitle} 가격 설정`}
                          onClick={() => setPriceProductId(row.productId)}
                        >
                          가격 설정
                        </button>
                      </div>
                    </td>
                    <td>{row.basePrice.toLocaleString('ko-KR')}</td>
                    <td>
                      <TimeSaleSwitch
                        checked={
                          display.productActions?.[row.productId]?.autoUpdate ??
                          true
                        }
                        onChange={(checked) =>
                          patchProductAction(row.productId, {
                            autoUpdate: checked,
                          })
                        }
                        label={`${row.productTitle} 판매가 자동갱신`}
                      />
                    </td>
                    <td>
                      <button
                        className="ts-button"
                        aria-label={`${row.productTitle} 전/후처리 연관 상품`}
                        onClick={() => {
                          setSelectedRelated([]);
                          setRelatedParent(row.productId);
                        }}
                      >
                        {display.productActions?.[row.productId]?.related
                          ?.length ?? 0}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!selectedRows.length && (
          <p className="ts-empty">
            {isFetching
              ? '불러오는 중…'
              : '상품 추가 버튼으로 타임세일 상품을 선택하세요.'}
          </p>
        )}
        {errors.length > 0 && (
          <p role="alert" className="ts-price-error">
            {errors.length}개 품목의 세일가를 확인하세요.
          </p>
        )}
      </TimeSaleDialog>
      <TimeSaleDialog
        open={priceProductId !== null}
        width={1000}
        title={`가격 설정 · ${selectedRows.find((row) => row.productId === priceProductId)?.productTitle ?? ''}`}
        onClose={() => setPriceProductId(null)}
      >
        <p className="ts-price-guide">
          {privatePrice
            ? '일반가는 그대로 두고 멤버십 회원에게만 할인합니다.'
            : '일반 세일가를 입력하세요. 멤버십 추가 할인은 선택입니다.'}{' '}
          이번에 할인할 옵션만 금액을 입력하세요. 빈칸은 할인 제외입니다.
        </p>
        <div className="ts-table-scroll">
          <table className="ts-table ts-option-prices">
            <thead>
              <tr>
                <th>옵션</th>
                <th>기존 일반가</th>
                <th>일반 세일가</th>
                <th>기존 멤버십가</th>
                <th>멤버십 세일가 {privatePrice ? '' : '(선택)'}</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows
                .filter((row) => row.productId === priceProductId)
                .map((row) => {
                  const memberPrice = privatePrice
                    ? (row.membershipSalePrice ??
                      row.membershipBasePrice ??
                      row.basePrice)
                    : Math.min(
                        row.generalSalePrice ?? row.basePrice,
                        row.membershipSalePrice ??
                          row.membershipBasePrice ??
                          row.basePrice
                      );

                  return (
                    <Fragment key={row.variantId}>
                      <tr>
                        <td>{row.variantTitle || '기본 옵션'}</td>
                        <td>{row.basePrice.toLocaleString('ko-KR')}원</td>
                        <td>
                          {privatePrice ? (
                            '기존 가격 유지'
                          ) : (
                            <Input
                              type="number"
                              min="1"
                              aria-label={`${row.variantTitle} 일반 세일가`}
                              placeholder="할인 제외"
                              value={row.generalSalePrice ?? ''}
                              onChange={(event) =>
                                editPrice(
                                  row.variantId,
                                  'generalSalePrice',
                                  event.target.value
                                )
                              }
                            />
                          )}
                        </td>
                        <td>
                          {(
                            row.membershipBasePrice ?? row.basePrice
                          ).toLocaleString('ko-KR')}
                          원
                        </td>
                        <td>
                          <Input
                            type="number"
                            min="1"
                            aria-label={`${row.variantTitle} 멤버십 세일가`}
                            placeholder={
                              privatePrice ? '할인 제외' : '자동 적용'
                            }
                            value={row.membershipSalePrice ?? ''}
                            onChange={(event) =>
                              editPrice(
                                row.variantId,
                                'membershipSalePrice',
                                event.target.value
                              )
                            }
                          />
                        </td>
                      </tr>
                      <tr className="ts-customer-preview">
                        <td colSpan={5}>
                          <strong>고객 화면 미리보기</strong>
                          {' · '}
                          일반 고객:{' '}
                          {(privatePrice
                            ? row.basePrice
                            : (row.generalSalePrice ?? row.basePrice)
                          ).toLocaleString('ko-KR')}
                          원{' · '}
                          멤버십 회원: {memberPrice.toLocaleString('ko-KR')}원
                          {privatePrice &&
                            ' · 멤버십 회원 특가 (일반 고객에게 할인 금액 비공개)'}
                          {(privatePrice
                            ? row.membershipSalePrice
                            : row.generalSalePrice) === null &&
                            ' · 이 옵션은 할인 제외'}
                          {errors.find(
                            (error) => error.variantId === row.variantId
                          )?.message && (
                            <p role="alert">
                              {
                                errors.find(
                                  (error) => error.variantId === row.variantId
                                )?.message
                              }
                            </p>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="ts-price-guide">
          닫은 뒤 상품진열의 적용 버튼을 눌러야 저장됩니다.
        </p>
      </TimeSaleDialog>
      <TimeSaleDialog
        open={pickerOpen}
        wide
        title={
          pickingRelated
            ? '전/후처리 연관 상품 추가'
            : `상품추가 [${shortSaleNumber(detail?.saleId ?? '')} : ${title}]`
        }
        onClose={() => setPickerOpen(false)}
        footer={
          <button
            className="ts-button"
            disabled={!pickerIds.length}
            onClick={() => {
              if (pickingRelated && relatedParent) {
                if (pickerIds.includes(relatedParent) || pickerIds.length > 5) {
                  toast.error(
                    '본 상품을 제외한 연관 상품을 최대 5개 선택하세요.'
                  );
                  return;
                }

                const current =
                  display.productActions?.[relatedParent]?.related ?? [];
                patchProductAction(relatedParent, {
                  related: pickerIds.map(
                    (productId) =>
                      current.find((item) => item.productId === productId) ?? {
                        productId,
                      }
                  ),
                });
              } else {
                setSelectedIds(pickerIds);
              }
              setPickerOpen(false);
            }}
          >
            추가
          </button>
        }
      >
        <TimeSaleProductPicker
          selectedIds={pickerIds}
          onToggle={(id) =>
            setPickerIds((ids) =>
              ids.includes(id)
                ? ids.filter((value) => value !== id)
                : [...ids, id]
            )
          }
          onToggleMany={(ids, checked) =>
            setPickerIds((prev) =>
              checked
                ? [...new Set([...prev, ...ids])]
                : prev.filter((id) => !ids.includes(id))
            )
          }
          ignoreSaleTitle={detail?.title}
          allowRunningSales={pickingRelated}
        />
      </TimeSaleDialog>

      <TimeSaleDialog
        open={!!relatedParent}
        width={1200}
        title={
          <>
            전/후처리 연관 상품 설정 [
            <span className="ts-title-detail">
              {selectedRows.find((row) => row.productId === relatedParent)
                ?.productTitle ?? ''}
            </span>
            ]
          </>
        }
        onClose={() => setRelatedParent(null)}
        footer={
          <button
            className="ts-button"
            disabled={savingRelated}
            onClick={() => void saveRelated()}
          >
            {savingRelated ? '저장 중…' : '저장'}
          </button>
        }
      >
        <ul className="ts-related-notices">
          <li>
            타임세일 상품 실행/중지 시점에 진열, 판매 속성을 제어할 연관 상품을
            설정합니다. -- 전처리/후처리 연관 상품을 설정합니다.
          </li>
          <li>
            (주의) 타임세일 상품의 상태가 중지 상태가 아닌 경우 바로 적용됩니다.
            할인·타임세일 매대 추가는 별도로 상품 추가에서 설정합니다.
          </li>
        </ul>
        <div className="ts-toolbar">
          <span className="ts-count">{relatedIds.length} / 5</span>
          <div className="ts-toolbar-spacer" />
          <button
            className="ts-icon-button"
            aria-label="연관 상품 새로고침"
            onClick={() => {
              void refetchRelated();
            }}
          >
            <RefreshCw size={22} />
          </button>
          <button
            className="ts-button"
            onClick={() => {
              setPickingRelated(true);
              setPickerIds(relatedIds);
              setPickerOpen(true);
            }}
          >
            + 연관 상품 추가
          </button>
          <button
            className="ts-button"
            disabled={!selectedRelated.length}
            onClick={() => {
              if (!relatedParent) return;

              patchProductAction(relatedParent, {
                related: (
                  display.productActions?.[relatedParent]?.related ?? []
                ).filter((item) => !selectedRelated.includes(item.productId)),
              });
              setSelectedRelated([]);
            }}
          >
            <Trash2 size={14} /> 삭제
          </button>
        </div>
        <div className="ts-table-scroll">
          <table className="ts-table ts-related-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="연관 상품 전체 선택"
                    checked={
                      relatedIds.length > 0 &&
                      relatedIds.every((id) => selectedRelated.includes(id))
                    }
                    onChange={(event) =>
                      setSelectedRelated(event.target.checked ? relatedIds : [])
                    }
                  />
                </th>
                <th>상품번호</th>
                <th>상품코드</th>
                <th>상품명</th>
                {(['진열', '판매'] as const).map((attribute) => (
                  <th key={attribute}>
                    {attribute}{' '}
                    <TimeSaleExplanation
                      label={`연관 상품 ${attribute} 실행·중지 설정`}
                    >
                      <p>
                        <strong>
                          {attribute === '진열'
                            ? '세일할 동안 이 상품을 숨겼다가, 끝나면 다시 보여주려면 둘 다 체크하세요.'
                            : '세일할 동안 이 상품의 구매를 막았다가, 끝나면 다시 팔려면 둘 다 체크하세요.'}
                        </strong>
                      </p>
                      <p>
                        <strong>실행:Off</strong> → 세일 시작하면{' '}
                        {attribute === '진열' ? '숨기기' : '구매 막기'}
                        <br />
                        <strong>중지:On</strong> → 세일 중지·종료되면{' '}
                        {attribute === '진열'
                          ? '다시 보여주기'
                          : '다시 판매하기'}
                      </p>
                      <p>
                        체크가 없으면 그대로 둡니다. 위의 예·아니오는 지금
                        상태입니다.
                      </p>
                      <p>
                        저장을 눌러야 반영됩니다. 이미 세일 중이면 저장 즉시
                        적용됩니다.
                      </p>
                    </TimeSaleExplanation>
                  </th>
                ))}
                <th>품절</th>
                <th>이미지</th>
                <th>상품페이지</th>
                <th>소비자가</th>
                <th>판매가</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...new Map(
                  (relatedRows ?? []).map((row) => [row.productId, row])
                ).values(),
              ].map((row) => (
                <tr key={row.productId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${row.productTitle} 연관 상품 선택`}
                      checked={selectedRelated.includes(row.productId)}
                      onChange={(event) =>
                        setSelectedRelated((previous) =>
                          event.target.checked
                            ? [...previous, row.productId]
                            : previous.filter((id) => id !== row.productId)
                        )
                      }
                    />
                  </td>
                  <td>{row.productId.slice(-8)}</td>
                  <td>{row.productCode || '-'}</td>
                  <td className="ts-name">{row.productTitle}</td>
                  {(['display', 'selling'] as const).map((attribute) => (
                    <td key={attribute}>
                      <span
                        className={
                          (
                            attribute === 'display'
                              ? row.productDisplay
                              : row.productSelling
                          )
                            ? 'ts-product-yes'
                            : 'ts-product-no'
                        }
                      >
                        {(
                          attribute === 'display'
                            ? row.productDisplay
                            : row.productSelling
                        )
                          ? '예'
                          : '아니오'}
                      </span>
                      <div className="ts-product-actions">
                        {(['OffStart', 'OnStop'] as const).map((phase) => {
                          const key = `${attribute}${phase}` as
                            | 'displayOffStart'
                            | 'displayOnStop'
                            | 'sellingOffStart'
                            | 'sellingOnStop';
                          const label =
                            phase === 'OffStart' ? '실행:Off' : '중지:On';
                          const action = display.productActions?.[
                            relatedParent ?? ''
                          ]?.related?.find(
                            (item) => item.productId === row.productId
                          );

                          return (
                            <label key={phase}>
                              <input
                                type="checkbox"
                                aria-label={`${row.productTitle} 연관 ${attribute} ${label}`}
                                checked={action?.[key] ?? false}
                                disabled={
                                  phase === 'OffStart' &&
                                  !!action?.[
                                    attribute === 'display'
                                      ? 'displayOnStop'
                                      : 'sellingOnStop'
                                  ]
                                }
                                onChange={(event) => {
                                  if (!relatedParent) return;

                                  patchProductAction(relatedParent, {
                                    related: (
                                      display.productActions?.[relatedParent]
                                        ?.related ?? []
                                    ).map((item) =>
                                      item.productId === row.productId
                                        ? {
                                            ...item,
                                            [key]: event.target.checked,
                                            ...(phase === 'OnStop' &&
                                            event.target.checked
                                              ? {
                                                  [attribute === 'display'
                                                    ? 'displayOffStart'
                                                    : 'sellingOffStart']: true,
                                                }
                                              : {}),
                                          }
                                        : item
                                    ),
                                  });
                                }}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  ))}
                  <td>-</td>
                  <td>
                    {row.productThumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="ts-product-image"
                        src={resolvePublicFileUrl(row.productThumbnail) ?? ''}
                        alt={row.productTitle}
                      />
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {row.productHandle && STOREFRONT_URL ? (
                      <a
                        className="ts-product-detail-link"
                        href={`${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/products/${encodeURIComponent(row.productHandle)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        상품페이지
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>-</td>
                  <td>{row.basePrice.toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TimeSaleDialog>

      <TimeSaleDialog
        open={!!stylePicker}
        title={`${stylePicker?.platform === 'mobile' ? '모바일' : 'PC'} ${stylePicker ? styleLabels[stylePicker.surface] : ''} 진열매대 선택`}
        onClose={() => setStylePicker(null)}
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
            {stylePicker &&
              settingsQuery.data &&
              [
                settingsQuery.data.settings.styles[stylePicker.surface][
                  stylePicker.platform
                ],
                ...settingsQuery.data.settings.savedStyles.filter(
                  (style) =>
                    style.id !==
                    settingsQuery.data!.settings.styles[stylePicker.surface][
                      stylePicker.platform
                    ].id
                ),
              ].map((style, index) => (
                <tr key={style.id}>
                  <td>{styleLabels[stylePicker.surface]}</td>
                  <td>{style.name}</td>
                  <td>{stylePicker.platform === 'mobile' ? '모바일' : 'PC'}</td>
                  <td>
                    <button
                      className="ts-button"
                      onClick={() => {
                        patchStyle(stylePicker.surface, stylePicker.platform, {
                          styleId: index === 0 ? '' : style.id,
                        });
                        setStylePicker(null);
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
    </>
  );

  return onClose ? (
    dialogs
  ) : (
    <TimeSaleWorkspace>
      <div className="ts-management">{dialogs}</div>
    </TimeSaleWorkspace>
  );
}

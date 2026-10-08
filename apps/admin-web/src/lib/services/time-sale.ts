'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  medusaPriceListsApi,
  medusaProductPricingApi,
} from '@/lib/api/domains/medusa/price-lists';
import {
  defaultSaleDisplay,
  MAX_PRODUCT_PERIOD_GROUPS,
  type SaleDisplay,
  type SalePeriodMode,
} from '@packages/domain-types/time-sale';
import { isCustomError } from '@/lib/api/customError';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import { medusaTimeSalesApi } from '@/lib/api/domains/medusa/time-sales';
import { medusaCatalogApi } from '@/lib/api/domains/medusa/catalog';
import { medusaRegionsApi } from '@/lib/api/domains/medusa/regions';
import {
  buildPriceListPayloads,
  resolveTimeSaleStatus,
  toTimeSaleRows,
  validateRows,
  type TimeSalePeriod,
  type TimeSaleRow,
} from '@/features/mall/marketing/time-sale/time-sale-model';

const timeSaleKeys = {
  all: ['time-sales'] as const,
  lists: () => [...timeSaleKeys.all, 'list'] as const,
  products: (ids: string[]) => [...timeSaleKeys.all, 'products', ids] as const,
  variantMap: () => [...timeSaleKeys.all, 'variant-map'] as const,
  detail: (generalId: string) =>
    [...timeSaleKeys.all, 'detail', generalId] as const,
  search: (params: unknown) => [...timeSaleKeys.all, 'search', params] as const,
};

// 멤버십 세일가를 받을 고객 그룹. 환경변수가 없으면 멤버십 세일가 저장을 막는다(buildSaveBody).
const MEMBERSHIP_GROUP_ID =
  process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID ?? '';

/** 어드민 읽기는 전부 이 하나로 끝난다 — price list 를 세일 단위로 묶고 variant 별 가격까지 준다. */
function useAllTimeSales() {
  return useQuery({
    queryKey: timeSaleKeys.lists(),
    queryFn: () => medusaTimeSalesApi.list(),
    staleTime: 30_000,
  });
}

// 세일 목록(기간·품목 수 포함).
export function useTimeSaleList() {
  const query = useAllTimeSales();

  return {
    ...query,
    data: query.data?.map((sale) => ({
      ...sale,
      period: { startsAt: sale.startsAt ?? '', endsAt: sale.endsAt ?? '' },
      variantCount: Object.keys(sale.generalPrices).length,
    })),
  };
}

/**
 * 아직 끝나지 않은 세일에 걸린 품목 → 그 세일 이름.
 *
 * 상품 선택 화면이 "이미 세일 중" 을 표시하는 근거다. 같은 품목을 두 세일에 걸면 Medusa 가 한쪽
 * 가격만 적용하므로 고르기 전에 보여야 한다 — 저장 단계에서 막으면 이미 백 개를 고른 뒤다.
 */
export function useTimeSaleVariantMap() {
  const { data } = useAllTimeSales();

  const map = new Map<string, string>();
  const now = new Date();
  for (const sale of data ?? []) {
    const period = { startsAt: sale.startsAt ?? '', endsAt: sale.endsAt ?? '' };
    if (
      sale.status === 'draft' ||
      resolveTimeSaleStatus(period, now) === 'ended'
    )
      continue;
    for (const variantId of Object.keys(sale.generalPrices))
      map.set(variantId, sale.title);
    for (const variantId of Object.keys(sale.membershipPrices))
      map.set(variantId, sale.title);
  }

  return { data: map };
}

/** 세일에 올릴 상품 고르기용 Medusa 상품 목록. 상품관리 목록과 같은 페이지 크기로 넘긴다. */
export function useMedusaProductSearch(params: {
  keyword: string;
  page: number;
  pageSize: number;
  categoryId?: string;
}) {
  return useQuery({
    queryKey: timeSaleKeys.search(params),
    queryFn: () =>
      medusaCatalogApi.searchProducts(params.keyword || undefined, {
        limit: params.pageSize,
        offset: (params.page - 1) * params.pageSize,
        categoryId: params.categoryId,
      }),
    placeholderData: (previous) => previous,
  });
}

// 선택한 상품의 variant 별 가격 행(세일가 입력 표의 원본).
export function useTimeSaleProductRows(productIds: string[]) {
  return useQuery({
    queryKey: timeSaleKeys.products(productIds),
    queryFn: async (): Promise<TimeSaleRow[]> => {
      const products = await medusaProductPricingApi.getProducts(productIds);
      return toTimeSaleRows(products);
    },
    enabled: productIds.length > 0,
  });
}

/** 편집용 세일 상세. 세일의 키는 saleId 다 (옛 세일은 일반용, 없으면 멤버십용 price list id). */
export function useTimeSaleDetail(saleId: string | null) {
  const { data, isLoading } = useAllTimeSales();
  const sale = saleId
    ? data?.find(
        (item) => item.saleId === saleId || item.priceListIds.includes(saleId)
      )
    : undefined;
  const periodMode: SalePeriodMode = sale?.groups.some(
    (group) => group.productId !== null
  )
    ? 'product'
    : 'sale';

  return {
    isLoading: Boolean(saleId) && isLoading,
    data: sale && {
      saleId: sale.saleId,
      status: sale.status,
      generalId: sale.generalId,
      membershipId: sale.membershipId,
      title: sale.title,
      period: { startsAt: sale.startsAt ?? '', endsAt: sale.endsAt ?? '' },
      periodMode,
      productPeriods: Object.fromEntries(
        sale.products.map((product) => [
          product.productId,
          {
            startsAt: product.startsAt ?? '',
            endsAt: product.endsAt ?? '',
          },
        ])
      ),
      productIds: sale.productIds,
      savedPrices: {
        general: new Map(Object.entries(sale.generalPrices)),
        membership: new Map(Object.entries(sale.membershipPrices)),
      },
    },
  };
}

export class TimeSaleValidationError extends Error {}

type SaleInput = {
  title: string;
  period: TimeSalePeriod;
  rows: TimeSaleRow[];
  display?: SaleDisplay;
  periodMode?: SalePeriodMode;
  productPeriods?: Record<string, TimeSalePeriod>;
};

// 상품별 기간 모드의 요청 본문: 세일가가 있는 상품만, 개별 기간이
// 없으면 세일 기간으로. 상품 상한·기간 순서를 먼저 검사한다.
function buildProductPeriods(input: SaleInput) {
  const priced = new Set(
    input.rows
      .filter(
        (row) =>
          row.generalSalePrice !== null ||
          (row.membershipBasePrice !== null && row.membershipSalePrice !== null)
      )
      .map((row) => row.productId)
  );
  if (priced.size > MAX_PRODUCT_PERIOD_GROUPS) {
    throw new TimeSaleValidationError(
      `상품별 기간은 상품 ${MAX_PRODUCT_PERIOD_GROUPS}개까지입니다.`
    );
  }

  const products = [...priced].map((productId) => ({
    productId,
    ...(input.productPeriods?.[productId] ?? input.period),
  }));
  const invalid = products.find(
    (product) => !(Date.parse(product.startsAt) < Date.parse(product.endsAt))
  );
  if (invalid) {
    throw new TimeSaleValidationError(
      '상품별 종료 시각이 시작 시각보다 뒤여야 합니다.'
    );
  }

  return products;
}

// 서버가 400/409 로 거절한 건 화면에 그대로 보여줄 검증 에러로 바꾼다.
const toValidationError = (error: unknown) =>
  isCustomError(error) && (error.statusCode === 400 || error.statusCode === 409)
    ? new TimeSaleValidationError(error.message)
    : error;

// 저장 요청 본문 조립: 1) 행 검증 2) 멤버십 그룹·리전 확인
// 3) 가격표 payload 4) 현재 설정 revision 과 표시 설정 결합.
async function buildSaveBody(input: SaleInput, key: string | null) {
  const errors = validateRows(input.rows);
  if (errors.length > 0) {
    throw new TimeSaleValidationError(
      `${errors.length}개 품목의 세일가를 고쳐야 합니다.`
    );
  }

  // 그룹 id 가 없으면 멤버십 리스트를 만들 수 없다. 조용히 건너뛰면 운영자가 입력한 멤버십
  // 세일가가 통째로 버려지고 "멤버십 세일가 없음" 으로만 남는다 — 저장 전에 막는다.
  const wantsMembership = input.rows.some(
    (row) =>
      row.membershipBasePrice !== null && row.membershipSalePrice !== null
  );
  if (wantsMembership && !MEMBERSHIP_GROUP_ID) {
    throw new TimeSaleValidationError(
      '멤버십 고객그룹 id 가 설정되지 않아 멤버십 세일가를 저장할 수 없습니다 ' +
        '(NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID).'
    );
  }

  const { regions } = await medusaRegionsApi.list();
  const regionIds = regions.map((region) => region.id);
  if (regionIds.length === 0) {
    throw new TimeSaleValidationError(
      '리전을 찾지 못해 세일 가격 규칙을 만들 수 없습니다.'
    );
  }

  const { general, membership } = buildPriceListPayloads({
    title: input.title,
    period: input.period,
    rows: input.rows,
    regionIds,
    membershipGroupId: MEMBERSHIP_GROUP_ID,
  });
  const { settings, revision } = await medusaTimeSaleSettingsApi.get();
  const periodMode = input.periodMode ?? 'sale';

  return {
    saleId: key,
    periodMode,
    products: periodMode === 'product' ? buildProductPeriods(input) : undefined,
    title: input.title,
    period: input.period,
    general,
    membership,
    display:
      input.display ??
      (key ? settings.sales[key] : undefined) ??
      defaultSaleDisplay(),
    revision,
  };
}

/**
 * 타임세일 생성 = price list 두 개 생성.
 *
 * 두 리스트와 설정 저장은 Medusa 워크플로(`POST /admin/time-sales/save`) 한 번으로 끝난다.
 * 어느 단계든 실패하면 워크플로가 만든 리스트·가격·설정을 전부 되돌리므로 한쪽만 남지 않는다.
 */
export function useCreateTimeSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaleInput) => {
      const body = await buildSaveBody(input, null);

      return medusaTimeSalesApi
        .save({
          ...body,
          generalId: null,
          membershipId: null,
          status: 'active',
        })
        .catch((error: unknown) => {
          throw toValidationError(error);
        });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/**
 * 등록된 세일 수정.
 *
 * 가격은 **전부 지우고 새로 넣는다.** 개별 diff 를 계산하면 상품이 빠졌을 때 지울 행을 놓쳐
 * 세일에서 뺐다고 생각한 상품이 계속 세일가로 팔린다. 리스트당 수백 행 규모라 통째 교체가 싸다.
 *
 * 멤버십 리스트는 없다가 생기기도, 있다가 사라지기도 한다 — 운영자가 멤버십 세일가를 지웠는데
 * 옛 리스트가 남으면 구독자만 옛 가격에 산다.
 */
export function useUpdateTimeSale() {
  const queryClient = useQueryClient();
  const { data: sales } = useAllTimeSales();

  return useMutation({
    mutationFn: async (
      input: SaleInput & {
        saleId: string;
        generalId: string | null;
        membershipId: string | null;
      }
    ) => {
      const body = await buildSaveBody(input, input.saleId);
      const current = sales?.find((sale) => sale.saleId === input.saleId);

      return medusaTimeSalesApi
        .save({
          ...body,
          generalId: input.generalId,
          membershipId: input.membershipId,
          status: current?.status ?? 'active',
        })
        .catch((error: unknown) => {
          throw toValidationError(error);
        });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/** 세일 종료 = 두 리스트 모두 삭제. 가격 행이 사라져 즉시 원래 가격으로 돌아간다. */
export function useDeleteTimeSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (priceListIds: string[]) => {
      for (const id of priceListIds) {
        await medusaPriceListsApi.remove(id);
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

// 세일 활성/초안 전환. 기간 겹침 같은 서버 거절은 검증 에러로 올린다.
export function useSetTimeSaleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, active }: { ids: string[]; active: boolean }) =>
      medusaTimeSalesApi.setStatus(ids, active).catch((error: unknown) => {
        throw toValidationError(error);
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

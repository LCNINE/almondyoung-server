'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medusaProductPricingApi } from '@/lib/api/domains/medusa/price-lists';
import { medusaTimeSalesApi } from '@/lib/api/domains/medusa/time-sales';
import { medusaCatalogApi } from '@/lib/api/domains/medusa/catalog';
import {
  buildTimeSaleWriteBody,
  readServerReason,
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
  search: (params: unknown) => [...timeSaleKeys.all, 'search', params] as const,
};

function useAllTimeSales() {
  return useQuery({ queryKey: timeSaleKeys.lists(), queryFn: () => medusaTimeSalesApi.list(), staleTime: 30_000 });
}

export function useTimeSaleList() {
  const query = useAllTimeSales();
  return {
    ...query,
    data: query.data?.map((sale) => ({
      ...sale,
      period: { startsAt: sale.startsAt, endsAt: sale.endsAt },
      variantCount: Object.keys(sale.generalPrices).length,
      hasMembership: Object.keys(sale.membershipPrices).length > 0,
    })),
  };
}

/**
 * 아직 끝나지 않은 세일에 걸린 품목 → 그 세일 이름. 상품 선택 화면이 «이미 세일 중» 을 미리 보여주는
 * 편의 표시다 — 최종 차단은 서버가 한다. 서버는 공개(active) 세일끼리만 겹침을 막으므로 비공개는 뺀다.
 */
export function useTimeSaleVariantMap(excludeId?: string) {
  const { data } = useAllTimeSales();
  const map = new Map<string, string>();
  const now = new Date();
  for (const sale of data ?? []) {
    if (sale.id === excludeId || sale.status === 'draft') continue;
    if (resolveTimeSaleStatus({ startsAt: sale.startsAt, endsAt: sale.endsAt }, now, sale.status) === 'ended') continue;
    for (const variantId of Object.keys(sale.generalPrices)) map.set(variantId, sale.title);
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

export function useTimeSaleProductRows(productIds: string[]) {
  return useQuery({
    queryKey: timeSaleKeys.products(productIds),
    queryFn: async (): Promise<TimeSaleRow[]> => toTimeSaleRows(await medusaProductPricingApi.getProducts(productIds)),
    enabled: productIds.length > 0,
  });
}

export function useTimeSaleDetail(id: string | null) {
  const { data, isLoading } = useAllTimeSales();
  const sale = id ? data?.find((item) => item.id === id) : undefined;
  return {
    isLoading: Boolean(id) && isLoading,
    data: sale && {
      id: sale.id,
      title: sale.title,
      status: sale.status,
      period: { startsAt: sale.startsAt, endsAt: sale.endsAt },
      productIds: sale.productIds,
      savedPrices: {
        general: new Map(Object.entries(sale.generalPrices)),
        membership: new Map(Object.entries(sale.membershipPrices)),
      },
    },
  };
}

export class TimeSaleValidationError extends Error {}

type SaveInput = { title: string; period: TimeSalePeriod; status: 'draft' | 'active'; rows: TimeSaleRow[] };

const toBody = (input: SaveInput) => {
  const errors = validateRows(input.rows);
  if (errors.length > 0) throw new TimeSaleValidationError(`${errors.length}개 품목의 세일가를 고쳐야 합니다.`);
  return buildTimeSaleWriteBody(input);
};

/** 서버가 4xx 로 돌려준 사유(겹침·검증·잠금 시간초과)를 그대로 보여준다 — 「실패했습니다」 만으론 운영자가 고칠 수 없다. */
const rethrowReadable = (error: unknown): never => {
  const message = readServerReason(error);
  throw message ? new TimeSaleValidationError(message) : error;
};

export function useCreateTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) => medusaTimeSalesApi.create(toBody(input)).catch(rethrowReadable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

export function useUpdateTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput & { id: string }) =>
      medusaTimeSalesApi.update(input.id, toBody(input)).catch(rethrowReadable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/**
 * 공개/비공개 전환. 가격·이름·기간은 그대로 두고 상태만 바꾼다 — 서버 상세를 읽어 같은 본문으로 다시
 * 저장한다(쓰기 경로를 하나로 유지하려고 전용 라우트를 두지 않는다).
 */
export function useSetTimeSaleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: 'draft' | 'active' }) => {
      const sale = await medusaTimeSalesApi.get(input.id);
      return medusaTimeSalesApi
        .update(input.id, {
          title: sale.title,
          starts_at: sale.startsAt,
          ends_at: sale.endsAt,
          status: input.status,
          general_prices: Object.entries(sale.generalPrices).map(([variant_id, amount]) => ({ variant_id, amount })),
          membership_prices: Object.entries(sale.membershipPrices).map(([variant_id, amount]) => ({ variant_id, amount })),
        })
        .catch(rethrowReadable);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

/** 세일 삭제 = 서버가 리스트·링크·세일 행을 한 번에 지운다. 가격은 즉시 원래대로 돌아간다. */
export function useDeleteTimeSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medusaTimeSalesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePriceListPayload } from '@/lib/api/domains/medusa/price-lists';
import {
  medusaPriceListsApi,
  medusaProductPricingApi,
} from '@/lib/api/domains/medusa/price-lists';
import { medusaTimeSalesApi } from '@/lib/api/domains/medusa/time-sales';
import { medusaCatalogApi } from '@/lib/api/domains/medusa/catalog';
import { medusaRegionsApi } from '@/lib/api/domains/medusa/regions';
import {
  buildPriceListPayloads,
  findOverlapping,
  findVariantConflicts,
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
  detail: (generalId: string) => [...timeSaleKeys.all, 'detail', generalId] as const,
  search: (params: unknown) => [...timeSaleKeys.all, 'search', params] as const,
};

const MEMBERSHIP_GROUP_ID = process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID ?? '';

/** 어드민 읽기는 전부 이 하나로 끝난다 — price list 를 세일 단위로 묶고 variant 별 가격까지 준다. */
function useAllTimeSales() {
  return useQuery({
    queryKey: timeSaleKeys.lists(),
    queryFn: () => medusaTimeSalesApi.list(),
    staleTime: 30_000,
  });
}

export function useTimeSaleList() {
  const query = useAllTimeSales();

  return {
    ...query,
    data: query.data?.map((sale) => ({
      ...sale,
      period: { startsAt: sale.startsAt ?? '', endsAt: sale.endsAt ?? '' },
      variantCount: Object.keys(sale.generalPrices).length,
      priceListIds: [sale.generalId, sale.membershipId].filter(
        (id): id is string => Boolean(id)
      ),
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
    if (resolveTimeSaleStatus(period, now) === 'ended') continue;
    for (const variantId of Object.keys(sale.generalPrices)) map.set(variantId, sale.title);
    for (const variantId of Object.keys(sale.membershipPrices)) map.set(variantId, sale.title);
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
    queryFn: async (): Promise<TimeSaleRow[]> => {
      const products = await medusaProductPricingApi.getProducts(productIds);
      return toTimeSaleRows(products);
    },
    enabled: productIds.length > 0,
  });
}

/** 편집용 세일 상세. 세일의 키는 price list id 다 (일반용이 없으면 멤버십용). */
export function useTimeSaleDetail(priceListId: string | null) {
  const { data, isLoading } = useAllTimeSales();
  const sale = priceListId
    ? data?.find(
        (item) => item.generalId === priceListId || item.membershipId === priceListId
      )
    : undefined;

  return {
    isLoading: Boolean(priceListId) && isLoading,
    data: sale && {
      generalId: sale.generalId,
      membershipId: sale.membershipId,
      title: sale.title,
      period: { startsAt: sale.startsAt ?? '', endsAt: sale.endsAt ?? '' },
      productIds: sale.productIds,
      savedPrices: {
        general: new Map(Object.entries(sale.generalPrices)),
        membership: new Map(Object.entries(sale.membershipPrices)),
      },
    },
  };
}

export class TimeSaleValidationError extends Error {}

/**
 * 타임세일 생성 = price list 두 개 생성.
 *
 * 일반용을 먼저 만들고 멤버십용을 뒤에 만든다. 중간에 실패하면 일반용만 남는데, 그건 "멤버십
 * 구독자도 일반 세일가를 받는" 상태라 가격이 틀어지지 않는다. 순서를 뒤집으면 반대로 구독자만
 * 싸게 사는 절름발이 세일이 남는다.
 */
export function useCreateTimeSale() {
  const queryClient = useQueryClient();
  const { data: sales } = useAllTimeSales();

  return useMutation({
    mutationFn: async (input: { title: string; period: TimeSalePeriod; rows: TimeSaleRow[] }) => {
      const errors = validateRows(input.rows);
      if (errors.length > 0) {
        throw new TimeSaleValidationError(`${errors.length}개 품목의 세일가를 고쳐야 합니다.`);
      }

      // 기간 겹침 자체는 통과다 — 카테고리마다 기간이 다른 세일을 동시에 거는 게 목적이다.
      // 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽 가격만 적용하므로 그때만 막는다.
      const existing = (sales ?? []).map((sale) => ({
        id: sale.generalId ?? sale.membershipId ?? '',
        title: sale.title,
        startsAt: sale.startsAt ?? '',
        endsAt: sale.endsAt ?? '',
        variantIds: [
          ...Object.keys(sale.generalPrices),
          ...Object.keys(sale.membershipPrices),
        ],
      }));
      const conflicts = findVariantConflicts(
        input.rows.map((row) => row.variantId),
        findOverlapping(input.period, existing)
      );
      if (conflicts.length > 0) {
        throw new TimeSaleValidationError(
          `같은 품목이 이미 다른 세일에 걸려 있습니다: ${conflicts
            .map((sale) => `${sale.title} (${sale.conflictingVariantIds.length}개 품목)`)
            .join(', ')}`
        );
      }

      const { regions } = await medusaRegionsApi.list();
      const regionIds = regions.map((region) => region.id);
      if (regionIds.length === 0) {
        throw new TimeSaleValidationError('리전을 찾지 못해 세일 가격 규칙을 만들 수 없습니다.');
      }

      // 그룹 id 가 없으면 멤버십 리스트를 만들 수 없다. 조용히 건너뛰면 운영자가 입력한 멤버십
      // 세일가가 통째로 버려지고 "멤버십 세일가 없음" 으로만 남는다 — 저장 전에 막는다.
      const wantsMembership = input.rows.some(
        (row) => row.membershipBasePrice !== null && row.membershipSalePrice !== null
      );
      if (wantsMembership && !MEMBERSHIP_GROUP_ID) {
        throw new TimeSaleValidationError(
          '멤버십 고객그룹 id 가 설정되지 않아 멤버십 세일가를 저장할 수 없습니다 (NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID).'
        );
      }

      const { general, membership } = buildPriceListPayloads({
        title: input.title,
        period: input.period,
        rows: input.rows,
        regionIds,
        membershipGroupId: MEMBERSHIP_GROUP_ID,
      });

      const created = await medusaPriceListsApi.create(general);
      if (membership && MEMBERSHIP_GROUP_ID) {
        await medusaPriceListsApi.create(membership);
      }
      return created;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
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

  return useMutation({
    mutationFn: async (input: {
      generalId: string | null;
      membershipId: string | null;
      title: string;
      period: TimeSalePeriod;
      rows: TimeSaleRow[];
    }) => {
      const errors = validateRows(input.rows);
      if (errors.length > 0) {
        throw new TimeSaleValidationError(`${errors.length}개 품목의 세일가를 고쳐야 합니다.`);
      }

      const wantsMembership = input.rows.some(
        (row) => row.membershipBasePrice !== null && row.membershipSalePrice !== null
      );
      if (wantsMembership && !MEMBERSHIP_GROUP_ID) {
        throw new TimeSaleValidationError(
          '멤버십 고객그룹 id 가 설정되지 않아 멤버십 세일가를 저장할 수 없습니다 (NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID).'
        );
      }

      const { regions } = await medusaRegionsApi.list();
      const regionIds = regions.map((region) => region.id);
      if (regionIds.length === 0) {
        throw new TimeSaleValidationError('리전을 찾지 못해 세일 가격 규칙을 만들 수 없습니다.');
      }

      const { general, membership } = buildPriceListPayloads({
        title: input.title,
        period: input.period,
        rows: input.rows,
        regionIds,
        membershipGroupId: MEMBERSHIP_GROUP_ID,
      });

      const replacePrices = async (listId: string, prices: CreatePriceListPayload['prices']) => {
        const current = await medusaPriceListsApi.get(listId);
        await medusaPriceListsApi.batchPrices(listId, {
          create: prices,
          delete: (current.prices ?? []).map((price) => price.id),
        });
      };

      if (input.generalId) {
        await medusaPriceListsApi.update(input.generalId, {
          title: general.title,
          starts_at: general.starts_at,
          ends_at: general.ends_at,
        });
        await replacePrices(input.generalId, general.prices);
      }

      if (membership) {
        if (input.membershipId) {
          await medusaPriceListsApi.update(input.membershipId, {
            title: membership.title,
            starts_at: membership.starts_at,
            ends_at: membership.ends_at,
          });
          await replacePrices(input.membershipId, membership.prices);
        } else {
          await medusaPriceListsApi.create(membership);
        }
      } else if (input.membershipId) {
        await medusaPriceListsApi.remove(input.membershipId);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timeSaleKeys.all }),
  });
}

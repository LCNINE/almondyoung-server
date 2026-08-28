'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  medusaPriceListsApi,
  medusaProductPricingApi,
  type MedusaPriceList,
} from '@/lib/api/domains/medusa/price-lists';
import { medusaRegionsApi } from '@/lib/api/domains/medusa/regions';
import {
  MEMBERSHIP_PRICE_LIST_TITLE,
  buildPriceListPayloads,
  findOverlapping,
  groupTimeSales,
  toTimeSaleRows,
  validateRows,
  type TimeSalePeriod,
  type TimeSaleRow,
} from '@/features/mall/marketing/time-sale/time-sale-model';

const timeSaleKeys = {
  all: ['time-sales'] as const,
  lists: () => [...timeSaleKeys.all, 'list'] as const,
  products: (ids: string[]) => [...timeSaleKeys.all, 'products', ids] as const,
};

const MEMBERSHIP_GROUP_ID = process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID ?? '';

function useAllPriceLists() {
  return useQuery({
    queryKey: timeSaleKeys.lists(),
    queryFn: () => medusaPriceListsApi.list(),
    staleTime: 30_000,
  });
}

export function useTimeSaleList() {
  const query = useAllPriceLists();
  return {
    ...query,
    data: query.data ? groupTimeSales(query.data.price_lists) : undefined,
  };
}

/** 상시 멤버십 리스트의 id. 세일에 올릴 상품의 "현재 멤버십가" 를 이 리스트에서 읽는다. */
export function useMembershipPriceListId(): string | null {
  const { data } = useAllPriceLists();
  const found = data?.price_lists.find(
    (list: MedusaPriceList) => list.title === MEMBERSHIP_PRICE_LIST_TITLE
  );
  return found?.id ?? null;
}

export function useTimeSaleProductRows(productIds: string[], membershipPriceListId: string | null) {
  return useQuery({
    queryKey: timeSaleKeys.products(productIds),
    queryFn: async (): Promise<TimeSaleRow[]> => {
      const products = await medusaProductPricingApi.getProducts(productIds);
      return toTimeSaleRows(products, membershipPriceListId);
    },
    enabled: productIds.length > 0,
  });
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
  const { data: priceLists } = useAllPriceLists();

  return useMutation({
    mutationFn: async (input: { title: string; period: TimeSalePeriod; rows: TimeSaleRow[] }) => {
      const errors = validateRows(input.rows);
      if (errors.length > 0) {
        throw new TimeSaleValidationError(`${errors.length}개 품목의 세일가를 고쳐야 합니다.`);
      }

      const existing = groupTimeSales(priceLists?.price_lists ?? []).map((sale) => ({
        id: sale.general?.id ?? sale.membership?.id,
        title: sale.title,
        ...sale.period,
      }));
      const overlapping = findOverlapping(input.period, existing);
      if (overlapping.length > 0) {
        throw new TimeSaleValidationError(
          `기간이 겹치는 세일이 있습니다: ${overlapping.map((sale) => sale.title).join(', ')}`
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

      const created = await medusaPriceListsApi.create(general);
      if (membership && MEMBERSHIP_GROUP_ID) {
        await medusaPriceListsApi.create(membership);
      }
      return created;
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

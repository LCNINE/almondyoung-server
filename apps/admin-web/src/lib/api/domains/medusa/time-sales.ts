'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  PriceListPayload,
  TimeSalePeriod,
} from '@/features/mall/marketing/time-sale/time-sale-model';

export type AdminTimeSaleProductPeriod = {
  productId: string;
  startsAt: string | null;
  endsAt: string | null;
};

/**
 * 어드민이 보는 타임세일. Medusa 의 커스텀 라우트가 price list 두 개를 한 세일로 묶어 준다.
 *
 * price list Admin API 를 직접 읽지 않는 이유: 거기서는 가격이 어느 variant 의 것인지 알 수 없다.
 * pricing 모듈이 product 를 모르기 때문이고, `*prices.price_set.variant` 확장은 그대로 터진다.
 */
export interface AdminTimeSale {
  saleId: string;
  status: 'active' | 'draft';
  generalId: string | null;
  membershipId: string | null;
  priceListIds: string[];
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  products: AdminTimeSaleProductPeriod[];
  groups: (AdminTimeSaleProductPeriod & {
    productId: string | null;
    generalId: string | null;
    membershipId: string | null;
  })[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
}

export type SaveTimeSaleBody = {
  saleId: string | null;
  periodMode: SalePeriodMode;
  products?: { productId: string; startsAt: string; endsAt: string }[];
  generalId: string | null;
  membershipId: string | null;
  title: string;
  period: TimeSalePeriod;
  general: PriceListPayload;
  membership: PriceListPayload | null;
  display: SaleDisplay;
  revision: string;
  status: 'active' | 'draft';
};

export type SaveTimeSaleResult = {
  saleId: string;
  generalId: string | null;
  membershipId: string | null;
  revision: string;
};

export const medusaTimeSalesApi = {
  list: async (signal?: AbortSignal) => {
    const config = { timeout: 15_000, retry: 0, signal };

    const res = await client.get<{ timeSales: AdminTimeSale[] }>(
      `${MEDUSA_BASE_URL}/admin/time-sales`,
      config
    );
    return res.data.timeSales;
  },
  save: async (body: SaveTimeSaleBody) =>
    (
      await client.post<SaveTimeSaleResult>(
        `${MEDUSA_BASE_URL}/admin/time-sales/save`,
        body
      )
    ).data,
  setStatus: async (priceListIds: string[], active: boolean) =>
    (
      await client.post<{ priceListIds: string[]; active: boolean }>(
        `${MEDUSA_BASE_URL}/admin/time-sales/status`,
        { priceListIds, active }
      )
    ).data,
};

import type {
  SaleDisplay,
  SalePeriodMode,
  TimeSaleSettings,
} from '@packages/domain-types/time-sale';

export const medusaTimeSaleSettingsApi = {
  get: async () =>
    (
      await client.get<{ settings: TimeSaleSettings; revision: string }>(
        `${MEDUSA_BASE_URL}/admin/time-sale-settings`
      )
    ).data,
  save: async (settings: TimeSaleSettings, revision: string) =>
    (
      await client.post<{ settings: TimeSaleSettings; revision: string }>(
        `${MEDUSA_BASE_URL}/admin/time-sale-settings`,
        { settings, revision }
      )
    ).data,
};

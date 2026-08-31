'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

/**
 * 어드민이 보는 타임세일. Medusa 의 커스텀 라우트가 price list 두 개를 한 세일로 묶어 준다.
 *
 * price list Admin API 를 직접 읽지 않는 이유: 거기서는 가격이 어느 variant 의 것인지 알 수 없다.
 * pricing 모듈이 product 를 모르기 때문이고, `*prices.price_set.variant` 확장은 그대로 터진다.
 */
export interface AdminTimeSale {
  generalId: string | null;
  membershipId: string | null;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
}

export const medusaTimeSalesApi = {
  list: async () => {
    const res = await client.get<{ timeSales: AdminTimeSale[] }>(
      `${MEDUSA_BASE_URL}/admin/time-sales`
    );
    return res.data.timeSales;
  },
};

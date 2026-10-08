import type { MedusaContainer } from '@medusajs/framework/types';
import { syncTimeSaleProductActions } from '../utils/time-sale-product-actions';
import { repeatTimeSales } from '../utils/time-sale-settings';

// 매분 반복 세일의 기간을 다음 회차로 넘긴다(실제 로직은 repeatTimeSales).
export default async function timeSaleRepeatJob(container: MedusaContainer) {
  await repeatTimeSales(container);

  await syncTimeSaleProductActions(container);
}

export const config = { name: 'time-sale-repeat', schedule: '* * * * *' };

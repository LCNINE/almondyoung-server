import type { MedusaContainer } from '@medusajs/framework/types';
import { repeatTimeSales } from '../utils/time-sale-settings';

export default async function timeSaleRepeatJob(container: MedusaContainer) {
  await repeatTimeSales(container);
}

export const config = { name: 'time-sale-repeat', schedule: '* * * * *' };

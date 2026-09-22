import type { MedusaContainer } from '@medusajs/framework/types';
import { notifyExpiringCoupons } from '../scripts/notify-expiring-coupons';

export default async function notifyExpiringCouponsJob(container: MedusaContainer) {
  await notifyExpiringCoupons(container);
}

export const config = {
  name: 'notify-expiring-coupons',
  schedule: '7 1 * * *',
};

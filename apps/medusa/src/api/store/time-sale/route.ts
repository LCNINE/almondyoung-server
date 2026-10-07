import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listAllTimeSales } from '../../../utils/time-sale';
import { loadTimeSaleSettings } from '../../../utils/time-sale-settings';
import { defaultSaleDisplay } from '../../../../../../packages/domain-types/time-sale';

/** Presentation only: products and prices still go through the authorized product API. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { settings } = await loadTimeSaleSettings(req.scope);
  const now = Date.now();

  const timeSales = (await listAllTimeSales(req.scope))
    .filter((s) => {
      if (s.status !== 'active') return false;
      const d = settings.sales[s.generalId ?? s.membershipId ?? ''] ?? defaultSaleDisplay();
      return (
        (!s.startsAt || Date.parse(s.startsAt) <= now || d.showScheduled) &&
        (!s.endsAt || Date.parse(s.endsAt) > now || d.showEnded)
      );
    })
    .map((sale) => ({
      title: sale.title,
      startsAt: sale.startsAt,
      endsAt: sale.endsAt,
      priceListIds: [sale.generalId, sale.membershipId].filter(Boolean),
      productIds: sale.productIds,
      display: settings.sales[sale.generalId ?? sale.membershipId ?? ''] ?? defaultSaleDisplay(),
    }))
    .sort((a, b) => a.display.order - b.display.order);

  return res.json({
    timeSales: settings.environment.enabled ? timeSales : [],
    settings: { ...settings, savedStyles: [] },
  });
}

import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listAllTimeSales } from '../../../utils/time-sale';
import { loadTimeSaleSettings } from '../../../utils/time-sale-settings';
import { defaultSaleDisplay } from '../../../../../../packages/domain-types/time-sale';

/** Presentation only: products and prices still go through the authorized product API. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sales = await listAllTimeSales(req.scope);
  const { settings } = await loadTimeSaleSettings(req.scope, sales);
  const now = Date.now();

  // 활성 세일 중 예정/종료 노출 설정에 맞는 것만 순서대로 내려준다.
  const timeSales = sales
    .filter((s) => {
      if (s.status !== 'active') return false;
      const d = settings.sales[s.saleId] ?? defaultSaleDisplay();
      return (
        (!s.startsAt || Date.parse(s.startsAt) <= now || d.showScheduled) &&
        (!s.endsAt || Date.parse(s.endsAt) > now || d.showEnded)
      );
    })
    .map((sale) => ({
      saleId: sale.saleId,
      title: sale.title,
      startsAt: sale.startsAt,
      endsAt: sale.endsAt,
      priceListIds: sale.priceListIds,
      productIds: sale.productIds,
      products: sale.products,
      display: settings.sales[sale.saleId] ?? defaultSaleDisplay(),
    }))
    .sort((a, b) => a.display.order - b.display.order);

  return res.json({
    timeSales: settings.environment.enabled ? timeSales : [],
    // 저장된 스타일 목록은 스토어프론트에 필요 없어 비운다.
    settings: { ...settings, savedStyles: [] },
  });
}

'use client';

import { PromotionTracker } from '@/components/analytics/promotion-tracker';
import sanitizeHtml from 'sanitize-html';
import type { TimeSaleSettings, SaleSurface } from '@packages/domain-types/time-sale';
import { SaleRenderer, type SalePagerItem, type SalePeriodLike, type SaleProduct } from '@packages/time-sale-ui';

export function ConfiguredTimeSale({
  settings,
  surface,
  saleId,
  title,
  startsAt,
  endsAt,
  products,
  countryCode,
  pager,
  sectionPeriods,
}: {
  settings: TimeSaleSettings;
  surface: SaleSurface;
  saleId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  products: SaleProduct[];
  countryCode: string;
  pager?: SalePagerItem[];
  sectionPeriods: SalePeriodLike[];
}) {
  return (
    <PromotionTracker
      key={`${saleId}:${surface}`}
      promotion={{
        promotion_id: settings.sales[saleId]?.webId || saleId,
        promotion_name: title,
        creative_slot: `time_sale_${surface}:${settings.sales[saleId]?.partitionId || 'home-sale'}`,
        items: products.map((product) => ({
          item_id: product.id,
          item_name: product.name,
        })),
      }}
    >
      <SaleRenderer
        settings={settings}
        surface={surface}
        saleId={saleId}
        title={title}
        startsAt={startsAt}
        endsAt={endsAt}
        products={products.map((product) => ({
          ...product,
          membershipOnly: settings.environment.membershipPriceOnly || !!settings.sales[saleId]?.membershipPriceOnly,
        }))}
        sanitizeHtml={sanitizeHtml}
        moreHref={`/${countryCode}/time-sale?sale=${encodeURIComponent(saleId)}`}
        pager={pager}
        sectionPeriods={sectionPeriods}
      />
    </PromotionTracker>
  );
}

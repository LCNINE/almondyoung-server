"use client"

import sanitizeHtml from "sanitize-html"
import type {
  TimeSaleSettings,
  SaleSurface,
} from "@packages/domain-types/time-sale"
import { SaleRenderer, type SaleProduct } from "@packages/time-sale-ui"

export function ConfiguredTimeSale({
  settings,
  surface,
  saleId,
  title,
  startsAt,
  endsAt,
  products,
  countryCode,
}: {
  settings: TimeSaleSettings
  surface: SaleSurface
  saleId: string
  title: string
  startsAt: string
  endsAt: string
  products: SaleProduct[]
  countryCode: string
}) {
  return (
    <SaleRenderer
      settings={settings}
      surface={surface}
      saleId={saleId}
      title={title}
      startsAt={startsAt}
      endsAt={endsAt}
      products={products}
      sanitizeHtml={sanitizeHtml}
      moreHref={`/${countryCode}/time-sale`}
    />
  )
}

import type { StoreProduct } from "@medusajs/types"

type TimeSaleMetadata = Record<string, unknown>

type TimeSaleInfo = {
  isActive: boolean
  endTime?: string
}

const getMetadataValue = (metadata: TimeSaleMetadata, keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key]
    if (value != null) {
      return value
    }
  }

  return null
}

const parseTimeValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

export const getTimeSaleInfo = (product: StoreProduct): TimeSaleInfo => {
  const metadata = (product.metadata ?? {}) as TimeSaleMetadata

  const startValue = getMetadataValue(metadata, [
    "time_sale_start",
    "time_sale_start_at",
    "timeSaleStart",
    "sale_start",
    "sale_start_at",
    "starts_at",
    "start_at",
  ])

  const endValue = getMetadataValue(metadata, [
    "time_sale_end",
    "time_sale_end_at",
    "timeSaleEnd",
    "sale_end",
    "sale_end_at",
    "ends_at",
    "end_at",
  ])

  const startTime = parseTimeValue(startValue)
  const endTime = parseTimeValue(endValue)
  const now = Date.now()

  if (startTime && now < startTime) {
    return { isActive: false }
  }

  if (endTime && now > endTime) {
    return { isActive: false, endTime: new Date(endTime).toISOString() }
  }

  if (startTime || endTime) {
    return {
      isActive: true,
      endTime: endTime ? new Date(endTime).toISOString() : undefined,
    }
  }

  return { isActive: false }
}

export const isTimeSaleProduct = (product: StoreProduct) =>
  getTimeSaleInfo(product).isActive

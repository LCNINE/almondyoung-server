"use server"

import { sdk } from "@/checkout-ui/lib/config/medusa"
import medusaError from "@/checkout-ui/lib/utils/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "../../data/cookies"

export const listRegions = async () => {
  const next = {
    ...(await getCacheOptions("regions")),
  }

  return sdk.client
    .fetch<{ regions: HttpTypes.StoreRegion[] }>(`/store/regions`, {
      method: "GET",
      next,
      cache: "force-cache",
    })
    .then(({ regions }) => regions)
    .catch(medusaError)
}

export const retrieveRegion = async (id: string) => {
  const next = {
    ...(await getCacheOptions(["regions", id].join("-"))),
  }

  return sdk.client
    .fetch<{ region: HttpTypes.StoreRegion }>(`/store/regions/${id}`, {
      method: "GET",
      next,
      cache: "force-cache",
    })
    .then(({ region }) => region)
    .catch(medusaError)
}

const regionMap = new Map<string, HttpTypes.StoreRegion>()

export const getRegion = async (countryCode: string) => {
  try {
    // iso_2 는 소문자로 오지만 호출부의 countryCode 는 "KR" 로도 들어온다.
    // 양쪽을 같은 형태로 맞추지 않으면 값이 있어도 miss 가 나 region_id 없이 진행된다.
    const key = countryCode?.trim().toLowerCase() || "us"

    if (regionMap.has(key)) {
      return regionMap.get(key)
    }

    const regions = await listRegions()
    if (!regions) {
      return null
    }

    regions.forEach((region) => {
      region.countries?.forEach((c) => {
        const iso = c?.iso_2?.trim().toLowerCase()
        if (iso) {
          regionMap.set(iso, region)
        }
      })
    })

    return regionMap.get(key)
  } catch (e: unknown) {
    console.error(`getRegion failed (countryCode=${countryCode}):`, e)
    return null
  }
}

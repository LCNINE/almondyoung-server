"use client"

import { useEffect } from "react"
import { recordShopListingView } from "@/lib/api/pim/shop-listings"

export function ViewBeacon({ slug }: { slug: string }) {
  // 중복 제거는 서버가 한다 (방문자·매물·날짜 unique). 여기서 막을 게 없다.
  useEffect(() => {
    void recordShopListingView(slug)
  }, [slug])

  return null
}

"use server"

import { getTimeSaleOverview } from "@/lib/api/medusa/time-sale"
import {
  loadTimeSaleAll,
  type TimeSaleAllProps,
} from "../templates/time-sale-all-template"

// 메인 매대 더보기를 팝업으로 열 때 한 페이지씩 받는다(더보기 페이지와 같은 계산).
export async function loadTimeSaleMore(
  countryCode: string,
  tabKey: string,
  page: number
): Promise<TimeSaleAllProps | null> {
  const overview = await getTimeSaleOverview()

  return loadTimeSaleAll({ overview, countryCode, tabKey, page })
}

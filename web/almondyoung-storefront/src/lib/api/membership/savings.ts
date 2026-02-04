"use server"

import { api } from "../api"
import type { MonthlySavingsDto, RangeSavingsDto } from "@lib/types/dto/membership-savings"

// 이번달 절약액 조회
export async function getCurrentMonthSavings(): Promise<MonthlySavingsDto> {
  return await api<MonthlySavingsDto>(
    "membership",
    "/membership/savings/current-month",
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

// 특정 월 절약액 조회
export async function getMonthSavings(
  yearMonth: string
): Promise<MonthlySavingsDto> {
  return await api<MonthlySavingsDto>(
    "membership",
    `/membership/savings/month/${yearMonth}`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

// 기간별 절약액 조회
export async function getRangeSavings(
  startDate: string,
  endDate: string
): Promise<RangeSavingsDto> {
  return await api<RangeSavingsDto>(
    "membership",
    `/membership/savings/range?startDate=${startDate}&endDate=${endDate}`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

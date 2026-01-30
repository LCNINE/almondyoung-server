"use server"

import { api } from "../api"

// 멤버십 절약액 DTO
export interface MonthlySavingsDto {
    yearMonth: string
    totalSavings: number
    breakdown: {
        discountSavings: number
        shippingFeeSavings: number
    }
}

export interface RangeSavingsDto {
    startDate: string
    endDate: string
    totalSavings: number
    monthlyBreakdown: Array<{
        yearMonth: string
        totalSavings: number
        breakdown: {
            discountSavings: number
            shippingFeeSavings: number
        }
    }>
}

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


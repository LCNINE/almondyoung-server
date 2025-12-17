import { BnplHistoryDto, BnplSummaryDto } from "../dto/wallet"

export interface BnplSummaryType extends BnplSummaryDto {}

/**
 * 나중결제 내역 조회
 */
export interface BnplHistoryType extends BnplHistoryDto {}

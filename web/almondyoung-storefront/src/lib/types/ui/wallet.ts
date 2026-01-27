import type {
  BnplHistoryDto,
  BnplSummaryDto,
  TaxInvoiceDto,
} from "../dto/wallet"

export interface BnplSummaryType extends BnplSummaryDto {}

/*───────────────────────────
 * 나중 결제 내역 조회
 *──────────────────────────*/
export interface BnplHistoryType extends BnplHistoryDto {}

/*───────────────────────────
 * 세금 계산서
 *──────────────────────────*/

export interface TaxInvoiceType extends TaxInvoiceDto {}

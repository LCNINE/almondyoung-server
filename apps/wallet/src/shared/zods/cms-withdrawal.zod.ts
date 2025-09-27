// shared/zods/cms-withdrawal.zod.ts

import { z } from 'zod';

/**
 * CMS 출금 신청 DTO (최소 필수 필드만)
 *
 * HMS API RequestPaymentDto 기반
 */
export const CmsWithdrawalRequestSchema = z.object({
  /**
   * 거래 ID (API 호출마다 고유해야 함)
   * @constraint 30자, 영문/숫자/-//()/
   */
  transactionId: z
    .string()
    .min(1, '거래 ID는 필수입니다')
    .max(30, '거래 ID는 30자를 초과할 수 없습니다')
    .regex(
      /^[A-Za-z0-9\-()\/]+$/,
      '거래 ID는 영문, 숫자, -, (), /만 사용 가능합니다',
    ),

  /**
   * 출금 대상 회원 ID
   * @constraint 20자, 영문/숫자/-//()/
   */
  memberId: z
    .string()
    .min(1, '회원 ID는 필수입니다')
    .max(20, '회원 ID는 20자를 초과할 수 없습니다')
    .regex(
      /^[A-Za-z0-9\-()\/]+$/,
      '회원 ID는 영문, 숫자, -, (), /만 사용 가능합니다',
    ),

  /**
   * 출금 요청일 (YYYYMMDD)
   * @constraint 8자, 숫자
   */
  paymentDate: z
    .string()
    .length(8, '출금 요청일은 8자리여야 합니다 (YYYYMMDD)')
    .regex(/^\d{8}$/, '출금 요청일은 숫자만 입력 가능합니다 (YYYYMMDD)'),

  /**
   * 출금 요청 금액
   * @constraint 12자리 (최대 999,999,999,999원)
   */
  callAmount: z
    .number()
    .int('출금 금액은 정수여야 합니다')
    .min(1, '출금 금액은 1원 이상이어야 합니다')
    .max(999999999999, '출금 금액은 999,999,999,999원을 초과할 수 없습니다'),
});

export type CmsWithdrawalRequestDto = z.infer<
  typeof CmsWithdrawalRequestSchema
>;

/**
 * CMS 출금 결과 조회 DTO
 */
export const CmsWithdrawalInquirySchema = z.object({
  /**
   * 조회할 거래 ID
   */
  transactionId: z
    .string()
    .min(1, '거래 ID는 필수입니다')
    .max(30, '거래 ID는 30자를 초과할 수 없습니다'),
});

export type CmsWithdrawalInquiryDto = z.infer<
  typeof CmsWithdrawalInquirySchema
>;

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * BNPL 출금 요청 스키마
 */
export const RequestWithdrawalSchema = z.object({
    amount: z.number().positive().describe('출금 금액'),
    paymentDate: z
        .string()
        .regex(/^\d{8}$/, '날짜는 YYYYMMDD 형식이어야 합니다')
        .describe('출금 요청일 (YYYYMMDD)'),
    description: z.string().optional().describe('출금 설명 (선택사항)'),
    userId: z.string().optional().describe('테스트용 사용자 ID (선택사항)'),
});

/**
 * 출금 요청 DTO
 */
export class RequestWithdrawalDto extends createZodDto(RequestWithdrawalSchema) { }

/**
 * 출금 응답 DTO
 */
export class WithdrawalResponseDto {
    success: boolean;
    transactionId: string;
    memberId: string;
    amount: number;
    paymentDate: string;
    status: string;
    message?: string;
}

/**
 * 출금 상태 조회 응답 DTO
 */
export class WithdrawalStatusResponseDto {
    success: boolean;
    transactionId: string;
    memberId: string;
    memberName: string;
    paymentDate: string;
    callAmount: number;
    actualAmount: number;
    fee: number;
    status: string;
    result: {
        flag: 'Y' | 'N' | null;
        code: string | null;
        message: string | null;
    };
}

/**
 * 에러 응답 DTO
 */
export class WithdrawalErrorResponseDto {
    success: false;
    error: string;
    message: string;
}

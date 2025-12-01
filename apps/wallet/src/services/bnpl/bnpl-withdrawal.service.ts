import { Injectable, Logger } from '@nestjs/common';
import { HmsBatchCmsService } from '../hms-batch-cms.service';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { ulid } from 'ulid';

/**
 * BNPL 출금 결과 인터페이스
 */
export interface WithdrawalResult {
    success: boolean;
    transactionId: string;
    memberId: string;
    amount: number;
    paymentDate: string;
    status: string;
    message?: string;
    error?: string;
}

/**
 * 배치 출금 결과 인터페이스
 */
export interface BatchWithdrawalResult {
    totalCount: number;
    successCount: number;
    failureCount: number;
    results: WithdrawalResult[];
}

/**
 * BNPL 출금 서비스
 * 
 * HMS Batch CMS API를 통한 실제 출금(결제) 처리를 담당합니다.
 * 
 * 역할:
 * - 단일/배치 출금 요청
 * - 출금 상태 조회
 * - 출금 취소/수정
 * 
 * 설계 특징:
 * - 낮은 결합도: 컨트롤러와 스케줄러 모두에서 재사용 가능
 * - 멱등성: 동일한 transactionId로 재요청 시 안전하게 처리
 * - 테스트 용이성: 장부 데이터 없이도 직접 금액 지정하여 테스트 가능
 */
@Injectable()
export class BnplWithdrawalService {
    private readonly logger = new Logger(BnplWithdrawalService.name);

    constructor(
        private readonly hmsBatchCmsService: HmsBatchCmsService,
        private readonly profileService: PaymentProfileService,
        private readonly db: DbService<typeof walletSchema>,
    ) { }

    /**
     * 단일 사용자 출금 요청
     * 
     * @param params 출금 요청 파라미터
     * @returns 출금 요청 결과
     * 
     * 플로우:
     * 1. userId로 BNPL 프로필 조회
     * 2. 고유한 transactionId 생성
     * 3. HMS CMS API 호출하여 출금 요청
     * 4. 결과 반환
     */
    async requestWithdrawal(params: {
        userId: string;
        amount: number;
        paymentDate: string; // YYYYMMDD
        description?: string;
    }): Promise<WithdrawalResult> {
        const { userId, amount, paymentDate, description } = params;

        this.logger.log(`➡️ 출금 요청 시작 - userId: ${userId}, amount: ${amount}, date: ${paymentDate}`);

        try {
            // 1. 결제 프로필 조회
            const profiles = await this.profileService.getPaymentProfiles(userId);
            const bnplProfile = profiles.find(
                (p) => p.provider === 'HMS_BNPL' && p.status === 'ACTIVE'
            );

            if (!bnplProfile) {
                throw new Error('활성화된 BNPL 프로필을 찾을 수 없습니다.');
            }

            // 2. CMS Batch Profile에서 memberId 조회
            const [cmsBatchProfile] = await this.db.db.query.cmsBatchProfiles.findMany({
                where: (table, { eq }) => eq(table.id, bnplProfile.id),
                limit: 1,
            });

            if (!cmsBatchProfile || !cmsBatchProfile.memberId) {
                throw new Error('BNPL 프로필의 HMS 회원 정보를 찾을 수 없습니다.');
            }

            // 3. transactionId 생성 (고유성 보장)
            // HMS API 제한: 30자 이하. ULID는 26자이므로 접두사는 4자 미만이어야 함.
            const transactionId = `b_${ulid()}`;

            // 4. HMS CMS 출금 요청
            this.logger.log(`📤 HMS CMS 출금 요청 - transactionId: ${transactionId}`);

            const hmsResult = await this.hmsBatchCmsService.requestWithdrawal({
                transactionId,
                memberId: cmsBatchProfile.memberId,
                paymentDate,
                callAmount: amount,
            });

            if (!hmsResult.success) {
                this.logger.error(`❌ HMS 출금 요청 실패: ${hmsResult.message}`);
                return {
                    success: false,
                    transactionId,
                    memberId: cmsBatchProfile.memberId,
                    amount,
                    paymentDate,
                    status: 'FAILED',
                    error: hmsResult.message || '출금 요청 실패',
                };
            }

            this.logger.log(`✅ 출금 요청 성공 - transactionId: ${transactionId}`);

            return {
                success: true,
                transactionId,
                memberId: cmsBatchProfile.memberId,
                amount,
                paymentDate,
                status: hmsResult.data?.payment?.status || 'PENDING',
                message: '출금 요청이 성공적으로 처리되었습니다.',
            };
        } catch (error: any) {
            this.logger.error(`❌ 출금 요청 실패: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * 배치 출금 요청 (스케줄러용)
     * 
     * @param withdrawals 출금 요청 목록
     * @returns 배치 출금 결과
     * 
     * 특징:
     * - 각 출금 요청을 독립적으로 처리
     * - 일부 실패해도 나머지 계속 진행
     * - 전체 결과 집계하여 반환
     */
    async requestBatchWithdrawals(
        withdrawals: Array<{
            userId: string;
            amount: number;
            paymentDate: string;
        }>
    ): Promise<BatchWithdrawalResult> {
        this.logger.log(`➡️ 배치 출금 요청 시작 - 총 ${withdrawals.length}건`);

        const results: WithdrawalResult[] = [];
        let successCount = 0;
        let failureCount = 0;

        for (const withdrawal of withdrawals) {
            try {
                const result = await this.requestWithdrawal(withdrawal);
                results.push(result);

                if (result.success) {
                    successCount++;
                } else {
                    failureCount++;
                }
            } catch (error: any) {
                this.logger.error(
                    `❌ 배치 출금 실패 - userId: ${withdrawal.userId}, error: ${error.message}`
                );

                results.push({
                    success: false,
                    transactionId: '',
                    memberId: '',
                    amount: withdrawal.amount,
                    paymentDate: withdrawal.paymentDate,
                    status: 'ERROR',
                    error: error.message,
                });

                failureCount++;
            }
        }

        this.logger.log(
            `✅ 배치 출금 완료 - 성공: ${successCount}, 실패: ${failureCount}`
        );

        return {
            totalCount: withdrawals.length,
            successCount,
            failureCount,
            results,
        };
    }

    /**
     * 출금 상태 조회
     * 
     * @param transactionId 출금 거래 ID
     * @returns 출금 상태 정보
     */
    async getWithdrawalStatus(transactionId: string) {
        this.logger.log(`🔍 출금 상태 조회 - transactionId: ${transactionId}`);

        try {
            const result = await this.hmsBatchCmsService.getWithdrawal(transactionId);

            if (!result.success || !result.data) {
                throw new Error('출금 상태 조회 실패');
            }

            return {
                success: true,
                ...result.data.payment,
            };
        } catch (error: any) {
            this.logger.error(`❌ 출금 상태 조회 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 출금 취소
     * 
     * @param transactionId 출금 거래 ID
     * @returns 취소 결과
     */
    async cancelWithdrawal(transactionId: string) {
        this.logger.log(`🗑️ 출금 취소 요청 - transactionId: ${transactionId}`);

        try {
            const result = await this.hmsBatchCmsService.deleteWithdrawal(transactionId);

            if (!result.success) {
                throw new Error('출금 취소 실패');
            }

            this.logger.log(`✅ 출금 취소 성공 - transactionId: ${transactionId}`);

            return {
                success: true,
                transactionId,
                message: '출금이 성공적으로 취소되었습니다.',
            };
        } catch (error: any) {
            this.logger.error(`❌ 출금 취소 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 출금 수정 (날짜 또는 금액 변경)
     * 
     * @param transactionId 출금 거래 ID
     * @param params 수정할 파라미터
     * @returns 수정 결과
     */
    async updateWithdrawal(
        transactionId: string,
        params: {
            paymentDate: string;
            callAmount: number;
        }
    ) {
        this.logger.log(`✏️ 출금 수정 요청 - transactionId: ${transactionId}`);

        try {
            const result = await this.hmsBatchCmsService.updateWithdrawal(
                transactionId,
                params
            );

            if (!result.success) {
                throw new Error(result.message || '출금 수정 실패');
            }

            this.logger.log(`✅ 출금 수정 성공 - transactionId: ${transactionId}`);

            return {
                success: true,
                ...result.data.payment,
            };
        } catch (error: any) {
            this.logger.error(`❌ 출금 수정 실패: ${error.message}`);
            throw error;
        }
    }
}

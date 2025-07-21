import {
    Injectable,
    Logger,
    Inject,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { TRANSACTION_STATUS } from '../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { WalletTx } from '../shared/types';
/**
 * 정산(Settlement) 도메인 서비스
 * - 역할: 개별 거래 중심의 정산 처리를 담당합니다.
 */
@Injectable()
export class SettlementService {
    private readonly logger = new Logger(SettlementService.name);

    constructor(
        @Inject(PaymentProcessingPort)
        private readonly paymentProcessor: PaymentProcessingPort,
        @InjectDb() private readonly dbService: DbService<typeof schema>,
    ) { }

    /**
     * 정산 배치 생성 (테스트 환경: 1분마다 실행)
     * AUTHORIZED 상태인 거래들을 개별적으로 PG사에 출금 요청
     */
    @Cron('0 * * * * *', {
        name: 'settlement-batch-test',
        timeZone: 'Asia/Seoul',
    })
    async createMonthlySettlement() {
        this.logger.log('월별 정산 처리 시작');
        try {
            await this.dbService.db.transaction(async (tx) => {
                // 1. 'AUTHORIZED' 상태인 모든 bnplTransaction 조회 (정산 대상 선정)
                const pendingTransactions = await tx.query.bnplTransaction.findMany({
                    where: eq(schema.bnplTransaction.status, TRANSACTION_STATUS.AUTHORIZED),
                    with: {
                        bnplAccount: true, // userId를 얻기 위함
                    },
                });

                if (pendingTransactions.length === 0) {
                    this.logger.log('정산할 거래가 없습니다.');
                    return;
                }

                this.logger.log(`${pendingTransactions.length}건의 거래에 대한 정산 처리 시작`);

                // 2. 사용자별로 그룹화하여 정산 배치 생성
                const userGroups = this.groupTransactionsByUser(pendingTransactions);

                for (const userGroup of userGroups) {
                    await this.processUserSettlement(tx, userGroup, pendingTransactions);
                }

                this.logger.log('월별 정산 처리 완료');
            });
        } catch (error) {
            this.logger.error('월별 정산 처리 중 오류 발생', error);
        }
    }

    /**
     * 거래를 사용자별로 그룹화하는 헬퍼 메서드
     */
    private groupTransactionsByUser(transactions: any[]) {
        const userMap = new Map();

        for (const transaction of transactions) {
            const userId = transaction.bnplAccount.userId;
            const bnplAccountId = transaction.bnplAccountId;

            if (!userMap.has(userId)) {
                userMap.set(userId, {
                    userId,
                    bnplAccountId,
                    totalAmount: 0,
                    transactions: [],
                });
            }

            const userGroup = userMap.get(userId);
            userGroup.totalAmount += Number(transaction.amount);
            userGroup.transactions.push(transaction);
        }

        return Array.from(userMap.values());
    }

    /**
     * 개별 사용자의 정산을 처리하는 헬퍼 메서드
     */
    private async processUserSettlement(tx: WalletTx, userGroup: any, allTransactions: any[]) {
        try {
            // 사용자별 정산 배치 생성 (내부 회계용)
            const now = new Date();
            const yearMonth = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`;

            const [settlementBatch] = await tx
                .insert(schema.settlementBatch)
                .values({
                    bnplAccountId: userGroup.bnplAccountId,
                    batchNumber: `BATCH_${yearMonth}_${userGroup.userId}`,
                    totalAmount: userGroup.totalAmount,
                    dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 15),
                    status: 'PROCESSING',
                    batchPeriodStart: new Date(now.getFullYear(), now.getMonth(), 1),
                    batchPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
                })
                .returning();

            this.logger.log(`사용자 ${userGroup.userId} 정산 배치 생성: ${settlementBatch.id}`);

            // 각 거래 건별로 PG사에 출금 예약 요청
            for (const transaction of userGroup.transactions) {
                await this.processSingleTransactionSettlement(tx, transaction, settlementBatch.id);
            }

        } catch (error) {
            this.logger.error(`사용자 ${userGroup.userId} 정산 처리 중 오류:`, error);
        }
    }

    private async processSingleTransactionSettlement(
        tx: WalletTx,
        transaction: typeof schema.bnplTransaction.$inferSelect & { bnplAccount: typeof schema.bnplAccount.$inferSelect },
        batchId: string,
    ) {
        try {
            const paymentMethod = await tx.query.paymentMethod.findFirst({
                where: eq(schema.paymentMethod.userId, transaction.bnplAccount.userId),
                with: { batchCms: true },
            });

            if (!paymentMethod?.batchCms) throw new Error(`BatchCMS 정보 없음: ${transaction.id}`);

            // 3a. 개별 거래에 대해 PG사에 출금 예약 요청
            const chargeResult = await this.paymentProcessor.charge({
                memberId: paymentMethod.batchCms.hmsMemberId,
                amount: transaction.amount,
                invoiceId: transaction.invoiceId,
                paymentDate: this.calculateNextSettlementDate(),
            });

            if (chargeResult.success) {
                // 3b. ✅ 성공 시, 해당 거래의 'PaymentEvent'에 pgTransactionId를 업데이트
                await tx
                    .update(schema.paymentEvents)
                    .set({
                        pgTransactionId: chargeResult.transactionId,
                        status: TRANSACTION_STATUS.REQUESTED, // '정산 요청됨' 상태로 변경
                    })
                    .where(eq(schema.paymentEvents.invoiceId, transaction.invoiceId));

                // 3c. bnplTransaction 상태도 업데이트
                await tx
                    .update(schema.bnplTransaction)
                    .set({ status: TRANSACTION_STATUS.REQUESTED })
                    .where(eq(schema.bnplTransaction.id, transaction.id));

                // 3d. 이 거래를 내부 정산 배치에 연결 (settlementBatchItem 생성)
                await tx.insert(schema.settlementBatchItem).values({
                    id: ulid(),
                    batchId: batchId,
                    bnplTransactionId: transaction.id,
                    amount: transaction.amount,
                    transactionDate: transaction.createdAt,
                });

            } else {
                // PG사 예약 실패 시 처리
                await tx
                    .update(schema.bnplTransaction)
                    .set({ status: TRANSACTION_STATUS.FAILED })
                    .where(eq(schema.bnplTransaction.id, transaction.id));
                this.logger.error(`거래 ${transaction.id} 정산 요청 실패`);
            }
        } catch (error) {
            this.logger.error(`거래 ${transaction.id} 정산 처리 중 오류`, error);
            // 개별 실패가 전체 트랜잭션을 롤백시키지 않도록 try/catch로 감쌉니다.
        }
    }

    /**
     * 정산 결과 확인 (테스트 환경: 1분 30초마다 실행)
     * 'PROCESSING' 상태인 배치들의 최종 결과를 PG사에서 확인
     */
    @Cron('30 * * * * *', {
        name: 'check-settlement-results-test',
        timeZone: 'Asia/Seoul',
    })
    async checkSettlementResults() {
        this.logger.log('정산 결과 확인 시작');

        try {
            await this.dbService.db.transaction(async (tx) => {
                // 1. 'PROCESSING' 상태인 settlementBatch들을 조회
                const pendingBatches = await tx.query.settlementBatch.findMany({
                    where: eq(schema.settlementBatch.status, 'PROCESSING'),
                    with: {
                        items: {
                            with: {
                                bnplTransaction: true,
                            },
                        },
                    },
                });

                if (pendingBatches.length === 0) {
                    this.logger.log('확인할 정산 배치가 없습니다.');
                    return;
                }

                this.logger.log(`${pendingBatches.length}개의 정산 배치 결과 확인`);

                // 2. 각 배치에 대해 개별 거래의 결과를 확인
                for (const batch of pendingBatches) {
                    await this.checkBatchResult(tx, batch);
                }

                this.logger.log('정산 결과 확인 완료');
            });
        } catch (error) {
            this.logger.error('정산 결과 확인 실패:', error);
        }
    }

    /**
     * 개별 배치의 결과를 확인하는 헬퍼 메서드
     */
    private async checkBatchResult(tx: WalletTx, batch: any) {
        try {
            if (!batch.items || batch.items.length === 0) {
                this.logger.warn(`배치 ${batch.id}에 연결된 거래가 없습니다.`);
                return;
            }

            let allSettled = true;
            let anyFailed = false;

            // 각 거래의 paymentEvent에서 pgTransactionId를 찾아 상태 확인
            for (const item of batch.items) {
                const transaction = item.bnplTransaction;

                // 해당 거래의 paymentEvent에서 pgTransactionId 조회
                const paymentEvent = await tx.query.paymentEvents.findFirst({
                    where: eq(schema.paymentEvents.invoiceId, transaction.invoiceId),
                });

                if (!paymentEvent?.pgTransactionId) {
                    this.logger.warn(`거래 ${transaction.id}의 pgTransactionId가 없습니다.`);
                    allSettled = false;
                    continue;
                }

                // PG사에서 개별 거래 상태 확인
                const statusResult = await this.paymentProcessor.getPaymentStatus(paymentEvent.pgTransactionId);

                let transactionFinalStatus: typeof TRANSACTION_STATUS.CAPTURED | typeof TRANSACTION_STATUS.FAILED;
                let paymentEventStatus: typeof TRANSACTION_STATUS.CAPTURED | typeof TRANSACTION_STATUS.FAILED;

                // HMS API 응답을 우리 시스템 상태로 변환
                switch (statusResult.status) {
                    case 'CAPTURED':
                    case '출금성공':
                        transactionFinalStatus = TRANSACTION_STATUS.CAPTURED;
                        paymentEventStatus = TRANSACTION_STATUS.CAPTURED;
                        break;
                    case 'FAILED':
                    case '출금실패':
                        transactionFinalStatus = TRANSACTION_STATUS.FAILED;
                        paymentEventStatus = TRANSACTION_STATUS.FAILED;
                        anyFailed = true;
                        break;
                    case 'REQUESTED':
                    case '출금대기':
                    case '출금중':
                        // 아직 처리 중인 경우
                        this.logger.log(`거래 ${transaction.id} 아직 처리 중: ${statusResult.status}`);
                        allSettled = false;
                        continue;
                    default:
                        this.logger.warn(`알 수 없는 HMS 결제 상태: ${statusResult.status}`);
                        allSettled = false;
                        continue;
                }

                // paymentEvent 상태 업데이트
                await tx
                    .update(schema.paymentEvents)
                    .set({
                        status: paymentEventStatus,
                    })
                    .where(eq(schema.paymentEvents.id, paymentEvent.id));

                // bnplTransaction 상태 업데이트
                await tx
                    .update(schema.bnplTransaction)
                    .set({
                        status: transactionFinalStatus,
                    })
                    .where(eq(schema.bnplTransaction.id, transaction.id));

                this.logger.log(`거래 ${transaction.id} 상태 업데이트: ${transactionFinalStatus}`);
            }

            // 배치 전체 상태 결정
            if (allSettled) {
                const batchFinalStatus = anyFailed ? 'FAILED' : 'SETTLED';

                await tx
                    .update(schema.settlementBatch)
                    .set({
                        status: batchFinalStatus,
                        updatedAt: new Date(),
                    })
                    .where(eq(schema.settlementBatch.id, batch.id));

                if (batchFinalStatus === 'SETTLED') {
                    this.logger.log(`배치 ${batch.id} 정산 성공: ${batch.totalAmount}원`);
                } else {
                    this.logger.error(`배치 ${batch.id} 정산 실패: ${batch.totalAmount}원`);
                }
            }

        } catch (error) {
            this.logger.error(`배치 ${batch.id} 결과 확인 중 오류:`, error);
        }
    }

    /**
     * 다음 정산일(출금일)을 계산하는 헬퍼 메서드
     */
    private calculateNextSettlementDate(): string {
        const now = new Date();
        // 다음 달 15일로 설정
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
        const year = nextMonth.getFullYear();
        const month = (nextMonth.getMonth() + 1).toString().padStart(2, '0');
        const day = nextMonth.getDate().toString().padStart(2, '0');
        return `${year}${month}${day}`;
    }
}
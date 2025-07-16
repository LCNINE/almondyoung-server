import { Injectable, Logger } from '@nestjs/common';
import { DrizzleService } from '@app/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PaymentService } from './payment.service';
import { settlementBatch, settlementBatchItem, bnplTransaction } from '../bnpl/schema';

/**
 * 정산 서비스 - 이벤트 소싱 패턴 구현
 * 
 * 주요 역할:
 * 1. 정산 배치 생성 및 관리
 * 2. 정산 배치 항목 생성 및 관리
 * 3. 정산 처리 및 결제 캡처
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly db: DrizzleService,
    private readonly paymentService: PaymentService,
  ) {
    this.logger.log('🚀 정산 서비스 초기화 완료');
  }

  /**
   * 정산 배치 생성
   * 
   * @param bnplAccountId BNPL 계정 ID
   * @param month 정산 월 (YYYY-MM)
   * @returns 생성된 정산 배치
   */
  async createSettlementBatch(bnplAccountId: string, month: string) {
    this.logger.log(`정산 배치 생성 시작: ${bnplAccountId}, 월: ${month}`);
    
    try {
      // 월 시작일과 종료일 계산
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0); // 월의 마지막 날
      
      // 정산일 계산 (다음 달 1일)
      const dueDate = new Date(year, monthNum, 1);
      
      // 정산 배치 ID 생성
      const batchId = nanoid();
      
      // 정산 배치 생성
      const [batch] = await this.db.insert(settlementBatch)
        .values({
          id: batchId,
          bnplAccountId,
          batchNumber: month,
          totalAmount: 0, // 초기값은 0, 나중에 업데이트
          dueDate,
          status: 'PENDING',
          batchPeriodStart: startDate,
          batchPeriodEnd: endDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      
      this.logger.log(`정산 배치 생성 완료: ${batchId}`);
      
      // 해당 기간의 AUTHORIZED 상태의 거래 찾기
      const transactions = await this.db.query.bnplTransaction.findMany({
        where: (bnplTransaction, { and, eq, gte, lte }) => and(
          eq(bnplTransaction.bnplAccountId, bnplAccountId),
          eq(bnplTransaction.status, 'AUTHORIZED'),
          gte(bnplTransaction.createdAt, startDate),
          lte(bnplTransaction.createdAt, endDate)
        ),
      });
      
      // 정산 배치 항목 생성
      let totalAmount = 0;
      
      for (const transaction of transactions) {
        const itemId = nanoid();
        
        await this.db.insert(settlementBatchItem)
          .values({
            id: itemId,
            batchId,
            bnplTransactionId: transaction.id,
            amount: transaction.amount,
            transactionDate: transaction.createdAt,
            createdAt: new Date(),
          });
        
        totalAmount += Number(transaction.amount);
      }
      
      // 정산 배치 총액 업데이트
      await this.db.update(settlementBatch)
        .set({ totalAmount })
        .where(eq(settlementBatch.id, batchId));
      
      this.logger.log(`정산 배치 항목 생성 완료: ${transactions.length}개, 총액: ${totalAmount}원`);
      
      return {
        ...batch,
        totalAmount,
        itemCount: transactions.length,
      };
    } catch (error) {
      this.logger.error(`정산 배치 생성 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 정산 배치 처리
   * 
   * 플로우:
   * 1. 정산 배치 조회
   * 2. 정산 배치 항목 조회
   * 3. 각 항목에 대해 결제 캡처 처리
   * 4. 정산 배치 상태 업데이트
   * 
   * @param batchId 정산 배치 ID
   * @returns 정산 배치 처리 결과
   */
  async processSettlementBatch(batchId: string) {
    this.logger.log(`정산 배치 처리 시작: ${batchId}`);
    
    try {
      // 1. 정산 배치 조회
      const batch = await this.db.query.settlementBatch.findFirst({
        where: eq(settlementBatch.id, batchId),
      });
      
      if (!batch) {
        throw new Error(`정산 배치를 찾을 수 없습니다: ${batchId}`);
      }
      
      if (batch.status !== 'PENDING') {
        throw new Error(`정산 배치가 PENDING 상태가 아닙니다: ${batch.status}`);
      }
      
      // 2. 정산 배치 상태 업데이트 (PROCESSING)
      await this.db.update(settlementBatch)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .where(eq(settlementBatch.id, batchId));
      
      // 3. 정산 배치 항목 조회
      const items = await this.db.query.settlementBatchItem.findMany({
        where: eq(settlementBatchItem.batchId, batchId),
        with: {
          bnplTransaction: true,
        },
      });
      
      // 4. 각 항목에 대해 결제 캡처 처리
      const results = [];
      let successCount = 0;
      let failCount = 0;
      
      for (const item of items) {
        try {
          // 해당 거래의 인보이스 ID로 결제 이벤트 조회
          const paymentEvents = await this.paymentService.getPaymentEventsByInvoiceId(
            item.bnplTransaction.invoiceId
          );
          
          if (paymentEvents.length === 0) {
            throw new Error(`결제 이벤트를 찾을 수 없습니다: invoiceId=${item.bnplTransaction.invoiceId}`);
          }
          
          // REQUESTED 상태의 결제 이벤트 찾기
          const requestedEvent = paymentEvents.find(event => event.status === 'REQUESTED');
          
          if (!requestedEvent) {
            throw new Error(`REQUESTED 상태의 결제 이벤트를 찾을 수 없습니다: invoiceId=${item.bnplTransaction.invoiceId}`);
          }
          
          // 결제 캡처 처리
          const result = await this.paymentService.successPayment({
            invoiceId: requestedEvent.invoiceId,
            paymentMethodId: requestedEvent.paymentMethodId,
            amount: requestedEvent.amount,
            pgTransactionId: `settlement_${batchId}_${Date.now()}`,
            pgResponse: JSON.stringify({ status: 'success', batchId, timestamp: new Date() }),
            actor: 'SCHEDULER',
          });
          
          // 거래 상태 업데이트 (CAPTURED)
          await this.db.update(bnplTransaction)
            .set({ status: 'CAPTURED' })
            .where(eq(bnplTransaction.id, item.bnplTransaction.id));
          
          results.push({
            itemId: item.id,
            transactionId: item.bnplTransaction.id,
            invoiceId: item.bnplTransaction.invoiceId,
            amount: item.amount,
            status: 'SUCCESS',
            eventId: result.id,
          });
          
          successCount++;
        } catch (error) {
          this.logger.error(`정산 배치 항목 처리 실패: ${item.id}, 오류: ${error.message}`);
          
          results.push({
            itemId: item.id,
            transactionId: item.bnplTransaction.id,
            invoiceId: item.bnplTransaction.invoiceId,
            amount: item.amount,
            status: 'FAILED',
            error: error.message,
          });
          
          failCount++;
        }
      }
      
      // 5. 정산 배치 상태 업데이트 (SETTLED 또는 FAILED)
      const finalStatus = failCount === 0 ? 'SETTLED' : (successCount === 0 ? 'FAILED' : 'SETTLED');
      
      await this.db.update(settlementBatch)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(settlementBatch.id, batchId));
      
      this.logger.log(`정산 배치 처리 완료: ${batchId}, 성공: ${successCount}, 실패: ${failCount}`);
      
      return {
        batchId,
        status: finalStatus,
        totalItems: items.length,
        successCount,
        failCount,
        results,
      };
    } catch (error) {
      this.logger.error(`정산 배치 처리 실패: ${error.message}`);
      
      // 정산 배치 상태 업데이트 (FAILED)
      await this.db.update(settlementBatch)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(settlementBatch.id, batchId));
      
      throw error;
    }
  }

  /**
   * 정산 배치 조회
   * 
   * @param bnplAccountId BNPL 계정 ID
   * @param month 정산 월 (YYYY-MM)
   * @returns 정산 배치 목록
   */
  async getSettlementBatches(bnplAccountId: string, month?: string) {
    try {
      if (month) {
        return this.db.query.settlementBatch.findMany({
          where: (settlementBatch, { and, eq }) => and(
            eq(settlementBatch.bnplAccountId, bnplAccountId),
            eq(settlementBatch.batchNumber, month)
          ),
          orderBy: (settlementBatch, { desc }) => [desc(settlementBatch.createdAt)],
        });
      } else {
        return this.db.query.settlementBatch.findMany({
          where: eq(settlementBatch.bnplAccountId, bnplAccountId),
          orderBy: (settlementBatch, { desc }) => [desc(settlementBatch.createdAt)],
        });
      }
    } catch (error) {
      this.logger.error(`정산 배치 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 정산 배치 항목 조회
   * 
   * @param batchId 정산 배치 ID
   * @returns 정산 배치 항목 목록
   */
  async getSettlementBatchItems(batchId: string) {
    try {
      return this.db.query.settlementBatchItem.findMany({
        where: eq(settlementBatchItem.batchId, batchId),
        with: {
          bnplTransaction: true,
        },
        orderBy: (settlementBatchItem, { desc }) => [desc(settlementBatchItem.createdAt)],
      });
    } catch (error) {
      this.logger.error(`정산 배치 항목 조회 실패: ${error.message}`);
      throw error;
    }
  }
}
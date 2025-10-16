import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../shared/schemas/entities/schema';
import * as schema from '../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { ContractEventManager } from './subscription/contract-event.manager';

export interface RefundCompletedEvent {
  contractId: string;
  userId: string;
  amount: number;
  walletTransactionId: string;
  completedAt: string;
}

export interface RefundFailedEvent {
  contractId: string;
  userId: string;
  errorMessage: string;
}

@Injectable()
export class RefundEventHandler {
  private readonly logger = new Logger(RefundEventHandler.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  /**
   * Wallet에서 환불 완료 이벤트 수신
   */
  async handleRefundCompleted(event: RefundCompletedEvent): Promise<void> {
    this.logger.log(
      `환불 완료 이벤트 수신 - contractId: ${event.contractId}, amount: ${event.amount}`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 0. 계약 존재 여부 확인
        const [contract] = await tx
          .select()
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.id, event.contractId))
          .limit(1);

        if (!contract) {
          throw new Error('Contract not found');
        }

        // 멱등성 체크: 이미 환불 완료된 경우 스킵
        if (contract.refundCompleted) {
          this.logger.log(
            `환불 이미 완료됨 (멱등성) - contractId: ${event.contractId}`,
          );
          return;
        }

        // 1. REFUND_COMPLETED 이벤트 추가
        const refundEvent = await this.contractEventManager.addEvent(
          tx,
          event.contractId,
          'REFUND_COMPLETED',
          {
            amount: event.amount,
            walletTransactionId: event.walletTransactionId,
          },
          'SYSTEM',
          event.userId,
        );

        // 2. 계약 상태 업데이트
        await tx
          .update(schema.subscriptionContracts)
          .set({
            refundCompleted: true,
            refundCompletedAt: new Date(event.completedAt),
            walletReferenceId: event.walletTransactionId,
            lastEventId: refundEvent.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.subscriptionContracts.id, event.contractId));

        this.logger.log(
          `✅ 환불 완료 처리 성공 - contractId: ${event.contractId}`,
        );
      });
    } catch (error: any) {
      // DB 쿼리 에러를 명확한 에러로 변환
      if (error.message?.includes('Failed query')) {
        throw new Error('Contract not found');
      }
      throw error;
    }
  }

  /**
   * Wallet에서 환불 실패 이벤트 수신
   */
  async handleRefundFailed(event: RefundFailedEvent): Promise<void> {
    this.logger.log(
      `환불 실패 이벤트 수신 - contractId: ${event.contractId}, error: ${event.errorMessage}`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 0. 계약 존재 여부 확인
        const [contract] = await tx
          .select()
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.id, event.contractId))
          .limit(1);

        if (!contract) {
          throw new Error('Contract not found');
        }

        // 1. REFUND_FAILED 이벤트 추가
        const failEvent = await this.contractEventManager.addEvent(
          tx,
          event.contractId,
          'REFUND_FAILED',
          {
            errorMessage: event.errorMessage,
          },
          'SYSTEM',
          event.userId,
        );

        // 2. 계약 상태 업데이트
        await tx
          .update(schema.subscriptionContracts)
          .set({
            lastEventId: failEvent.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.subscriptionContracts.id, event.contractId));

        this.logger.warn(
          `⚠️ 환불 실패 처리 완료 - contractId: ${event.contractId}`,
        );

        // 3. 알림 발송 (추후 구현)
        // TODO: 어드민에게 환불 실패 알림 발송
      });
    } catch (error: any) {
      // DB 쿼리 에러를 명확한 에러로 변환
      if (error.message?.includes('Failed query')) {
        throw new Error('Contract not found');
      }
      throw error;
    }
  }
}

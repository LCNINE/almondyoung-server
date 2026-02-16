import { Injectable, Logger } from '@nestjs/common';
import { BnplEvent } from '../../shared/database/types';
import { BnplRepository } from './bnpl.repository';

/**
 * BnplRetryManager - 재시도 관리 (Implementation Layer)
 */
@Injectable()
export class BnplRetryManager {
  private readonly logger = new Logger(BnplRetryManager.name);
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly DUE_DATE_OFFSET_DAYS = 5;

  constructor(private readonly repo: BnplRepository) {}

  async retryBatch(originalBatchId: string, tx?: any): Promise<string> {
    // 1. 실패한 이벤트 조회
    const failedEvents = await this.repo.findFailedEventsByBatchId(
      originalBatchId,
      tx,
    );

    if (failedEvents.length === 0) {
      throw new Error('No failed events found for retry');
    }

    // 2. 재시도 횟수 확인
    const retryCount = await this.getRetryCount(originalBatchId);

    if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
      throw new Error('Maximum retry attempts exceeded');
    }

    // 3. 새 배치 ID 생성
    const newBatchId = `${originalBatchId}_RETRY_${retryCount + 1}`;
    const totalAmount = failedEvents.reduce(
      (sum: number, e: BnplEvent) => sum + e.amount,
      0,
    );
    const dueDateStr = this.calculateDueDate();

    // 4. 이벤트 업데이트
    const eventIds = failedEvents.map((e: BnplEvent) => e.id);
    await this.repo.updateEventsByIds(
      eventIds,
      {
        batchTransactionId: newBatchId,
        batchDueDate: dueDateStr,
        cmsStatus: 'REQUESTED',
        status: 'PENDING',
      },
      tx,
    );

    // 5. CMS 재시도 응답 기록
    const accountId = failedEvents[0].accountId;
    await this.repo.createCmsResponse(
      {
        batchId: newBatchId,
        accountId,
        responseType: 'BATCH_RETRY_ATTEMPTED',
        cmsResponseSnapshot: {
          batchId: newBatchId,
          originalBatchId,
          totalAmount,
          dueDate: dueDateStr,
          retryCount: retryCount + 1,
          eventIds: failedEvents.map((e: BnplEvent) => e.id),
          status: 'REQUESTED',
          requestDate: new Date().toISOString(),
        },
        previousStatus: 'FAILED',
        newStatus: 'REQUESTED',
      },
      tx,
    );

    this.logger.log(
      `Batch retry created: ${newBatchId} (retry ${retryCount + 1})`,
    );

    return newBatchId;
  }

  private async getRetryCount(originalBatchId: string): Promise<number> {
    const history = await this.repo.findCmsResponsesByBatchId(originalBatchId);
    return history.filter(
      (h: any) => h.responseType === 'BATCH_RETRY_ATTEMPTED',
    ).length;
  }

  private calculateDueDate(): string {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + this.DUE_DATE_OFFSET_DAYS);
    return dueDate.toISOString().split('T')[0];
  }
}

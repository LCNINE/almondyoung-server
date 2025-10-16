import { Injectable, Logger } from '@nestjs/common';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { BnplEvent } from '../../shared/database/types';
import { BnplRepository } from './bnpl.repository';

export interface BatchCreationResult {
  batchId: string;
  totalAmount: number;
  accountCount: number;
  eventCount: number;
}

/**
 * BnplBatchCreator - 배치 생성 (Implementation Layer)
 */
@Injectable()
export class BnplBatchCreator {
  private readonly logger = new Logger(BnplBatchCreator.name);
  private readonly DUE_DATE_OFFSET_DAYS = 5;

  constructor(private readonly repo: BnplRepository) {}

  async createBatch(tx?: any): Promise<BatchCreationResult> {
    const batchId = this.generateBatchId();

    // 1. 집계되지 않은 BNPL 이벤트 조회
    const pendingEvents = await this.repo.findPendingEventsForBatch(tx);

    if (pendingEvents.length === 0) {
      throw new Error('No pending events to aggregate');
    }

    // 2. 총액 계산
    const totalAmount = pendingEvents.reduce(
      (sum: number, event: BnplEvent) => sum + event.amount,
      0,
    );

    // 3. 계정별 그룹화
    const accountIds = [
      ...new Set(pendingEvents.map((e: BnplEvent) => e.accountId)),
    ];

    // 4. 출금 신청일 계산
    const dueDateStr = this.calculateDueDate();

    // 5. 이벤트 업데이트 (배치 정보 설정)
    const eventIds = pendingEvents.map((e: BnplEvent) => e.id);
    await this.repo.updateEventsByIds(
      eventIds,
      {
        batchTransactionId: batchId,
        batchDueDate: dueDateStr,
        isAggregated: true,
        cmsStatus: 'REQUESTED',
      },
      tx,
    );

    // 6. 각 계정별로 CMS 응답 기록
    for (const accountId of accountIds) {
      const accountEvents = pendingEvents.filter(
        (e: BnplEvent) => e.accountId === accountId,
      );
      const accountAmount = accountEvents.reduce(
        (sum: number, e: BnplEvent) => sum + e.amount,
        0,
      );

      await this.repo.createCmsResponse(
        {
          batchId,
          accountId,
          responseType: 'BATCH_REQUEST_SUBMITTED',
          cmsResponseSnapshot: {
            batchId,
            totalAmount: accountAmount,
            dueDate: dueDateStr,
            eventIds: accountEvents.map((e: BnplEvent) => e.id),
            status: 'REQUESTED',
            requestDate: new Date().toISOString(),
          },
          newStatus: 'REQUESTED',
        },
        tx,
      );
    }

    this.logger.log(
      `Batch created: ${batchId}, total: ${totalAmount}, accounts: ${accountIds.length}, events: ${pendingEvents.length}`,
    );

    return {
      batchId,
      totalAmount,
      accountCount: accountIds.length,
      eventCount: pendingEvents.length,
    };
  }

  private generateBatchId(): string {
    return `BATCH_${new Date().toISOString().split('T')[0]}_${generateUUIDv7().slice(0, 8)}`;
  }

  private calculateDueDate(): string {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + this.DUE_DATE_OFFSET_DAYS);
    return dueDate.toISOString().split('T')[0];
  }
}

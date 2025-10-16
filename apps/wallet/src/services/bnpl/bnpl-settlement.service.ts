import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { BnplRepository } from './bnpl.repository';
import { BnplBatchCreator } from './bnpl-batch.creator';
import { BnplCmsManager, CmsResponseDto } from './bnpl-cms.manager';
import { BnplRetryManager } from './bnpl-retry.manager';
import { BnplEvent } from '../../shared/database/types';

export interface BatchInfo {
  batchId: string;
  totalAmount: number;
  accountCount: number;
  eventCount: number;
}

export interface BatchStatus {
  batchId: string;
  status: string;
  totalAmount: number;
  events: BnplEvent[];
  history: any[];
}

/**
 * BnplSettlementService - BNPL 정산 서비스 (Business Layer)
 *
 * 책임:
 * - 비즈니스 흐름 중계
 * - 배치 생성, CMS 처리, 재시도 로직 조율
 * - 트랜잭션 경계 관리
 */
@Injectable()
export class BnplSettlementService {
  private readonly logger = new Logger(BnplSettlementService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly repo: BnplRepository,
    private readonly batchCreator: BnplBatchCreator,
    private readonly cmsManager: BnplCmsManager,
    private readonly retryManager: BnplRetryManager,
  ) {}

  /**
   * 월말 배치 생성 및 CMS 출금 신청
   */
  async createMonthlyBatch(): Promise<BatchInfo> {
    return await this.db.db.transaction(async (tx) => {
      return await this.batchCreator.createBatch(tx);
    });
  }

  /**
   * CMS 출금 결과 처리
   */
  async processCmsResult(
    batchId: string,
    success: boolean,
    cmsResponse: CmsResponseDto,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 배치에 속한 이벤트 조회
      const events = await this.repo.findEventsByBatchId(batchId, tx);

      if (events.length === 0) {
        throw new Error(`No events found for batch: ${batchId}`);
      }

      // 2. 계정 검증
      const accountIds = [...new Set(events.map((e) => e.accountId))];
      if (accountIds.length > 1) {
        throw new Error(
          `Batch contains multiple accounts: ${accountIds.join(', ')}`,
        );
      }
      const accountId = accountIds[0];

      // 3. 성공/실패 처리 및 응답 기록
      if (success) {
        await this.cmsManager.processSuccess(batchId, events, cmsResponse, tx);
      } else {
        await this.cmsManager.processFailure(batchId, events, cmsResponse, tx);
      }

      // 4. CMS 응답 기록
      await this.cmsManager.recordResponse(
        batchId,
        accountId,
        success,
        cmsResponse,
        tx,
      );

      this.logger.log(
        `CMS result processed: ${batchId} - ${success ? 'SUCCESS' : 'FAILURE'}`,
      );
    });
  }

  /**
   * 실패한 배치 재시도
   */
  async retryFailedBatch(originalBatchId: string): Promise<string> {
    return await this.db.db.transaction(async (tx) => {
      return await this.retryManager.retryBatch(originalBatchId, tx);
    });
  }

  /**
   * 배치 상태 조회
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const [events, history] = await Promise.all([
      this.repo.findEventsByBatchId(batchId),
      this.repo.findCmsResponsesByBatchId(batchId),
    ]);

    if (events.length === 0) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const totalAmount = events.reduce(
      (sum: number, e: BnplEvent) => sum + e.amount,
      0,
    );
    const latestHistory = history[0]; // 최신순 정렬되어 있음

    return {
      batchId,
      status: latestHistory?.newStatus || 'UNKNOWN',
      totalAmount,
      events,
      history,
    };
  }
}

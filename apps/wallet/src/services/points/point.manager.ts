import { Injectable, Logger } from '@nestjs/common';
import {
  PointRepository,
  AddPointsParams,
  RedeemParams,
  CancelPointsParams,
} from './point.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { walletSchema } from '../../shared/database/schema';

type DbTx = Parameters<
  Parameters<PostgresJsDatabase<typeof walletSchema>['transaction']>[0]
>[0];

/**
 * PointManager (Implementation Layer)
 *
 * 책임: Point 비즈니스 로직 (검증 + 실행 + 로깅)
 */
@Injectable()
export class PointManager {
  private readonly logger = new Logger(PointManager.name);

  constructor(private readonly repo: PointRepository) {}

  /**
   * 포인트 적립
   */
  async addPoints(params: AddPointsParams, tx?: DbTx) {
    // 1. 검증
    if (params.amount <= 0) {
      throw new Error('적립 금액은 양수여야 합니다.');
    }

    // 2. 실행
    const res = await this.repo.addPoints(params, tx);

    // 3. 로깅
    this.logger.log(
      `ADD_POINTS: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );

    return res;
  }

  /**
   * 포인트 사용
   */
  async redeem(params: RedeemParams, tx?: DbTx) {
    // 1. 검증
    if (params.amount <= 0) {
      throw new Error('사용 금액은 양수여야 합니다.');
    }

    // 2. 잔액 체크
    const balance = await this.repo.getBalance(params.partnerId);
    if (balance < params.amount) {
      throw new Error(
        `포인트가 부족합니다. 잔액: ${balance}, 요청: ${params.amount}`,
      );
    }

    // 3. 실행
    const res = await this.repo.redeem(params, tx);

    // 4. 로깅
    this.logger.log(
      `REDEEM: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );

    return res;
  }

  /**
   * 포인트 적립 취소
   */
  async cancelPoints(params: CancelPointsParams, tx?: DbTx) {
    // 1. 실행 (Repository에서 검증)
    const res = await this.repo.cancelPoints(params, tx);

    // 2. 로깅
    this.logger.log(
      `CANCEL_POINTS: partner=${params.partnerId} cancel=${res.cancel} event=${res.eventId}`,
    );

    return res;
  }
}

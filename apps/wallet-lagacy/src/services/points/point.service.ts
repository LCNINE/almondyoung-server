import { Injectable } from '@nestjs/common';
import { PointReader } from './point.reader';
import { PointManager } from './point.manager';
import type {
  AddPointsParams,
  RedeemParams,
  CancelPointsParams,
  PointHistoryItem,
} from './point.repository';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { walletSchema } from '../../shared/database/schema';

// 위치는 여기가 적절한지 모르겠지만, 상위레벨에서 tx가 any로 선언되어있어서 타입에러뜨는것을 방지하고자 export를 붙여줬습니다.-중식
export type DbTx = Parameters<
  Parameters<PostgresJsDatabase<typeof walletSchema>['transaction']>[0]
>[0];

/**
 * PointService (Business Layer)
 *
 * 책임: 비즈니스 흐름만 표현 (2-3줄)
 * - Reader/Manager를 통해서만 접근
 * - Repository 직접 참조 금지
 */
@Injectable()
export class PointService {
  constructor(
    private readonly pointReader: PointReader,
    private readonly pointManager: PointManager,
  ) { }

  /**
   * 잔액 조회
   */
  async getBalance(partnerId: string): Promise<number> {
    return await this.pointReader.getBalance(partnerId);
  }

  /**
   * 출금 가능 잔액 조회
   */
  async getWithdrawable(partnerId: string, now?: Date): Promise<number> {
    return await this.pointReader.getWithdrawable(partnerId, now);
  }

  /**
   * 포인트 내역 조회
   */
  async getHistory(
    partnerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointHistoryItem[]; total: number }> {
    return await this.pointReader.getHistory(partnerId, limit, offset);
  }

  /**
   * 포인트 적립
   */

  async addPoints(params: AddPointsParams, tx?: DbTx) {
    return await this.pointManager.addPoints(params, tx);
  }

  /**
   * 관리자 수동 지급
   */
  async grantByAdmin(params: AddPointsParams, tx?: DbTx) {
    return await this.pointManager.grantByAdmin(params, tx);
  }

  /**
   * 포인트 사용
   */
  async redeem(params: RedeemParams, tx?: DbTx) {
    return await this.pointManager.redeem(params, tx);
  }

  /**
   * 포인트 적립 취소
   */
  async cancelPoints(params: CancelPointsParams, tx?: DbTx) {
    return await this.pointManager.cancelPoints(params, tx);
  }
}

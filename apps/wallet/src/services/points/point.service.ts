// apps/wallet/src/services/point-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PointRepository,
  EarnParams,
  RedeemParams,
  EarnCancelParams,
} from './point.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { walletSchema } from '../../shared/database/schema';

// ✅ WMS 패턴: 트랜잭션 타입 정의
type DbTx = Parameters<
  Parameters<PostgresJsDatabase<typeof walletSchema>['transaction']>[0]
>[0];

@Injectable()
export class PointService {
  private readonly logger = new Logger(PointService.name);

  constructor(private readonly repo: PointRepository) {}

  /** 잔액 조회 */
  async getBalance(partnerId: number) {
    return this.repo.getBalance(partnerId);
  }

  /** 출금 가능 잔액 조회 */
  async getWithdrawable(partnerId: number, now?: Date) {
    return this.repo.getWithdrawable(partnerId, now);
  }

  /** 적립 */
  async earn(params: EarnParams, tx?: DbTx) {
    if (params.amount <= 0) throw new Error('적립 금액은 양수여야 합니다.');
    const res = await this.repo.earn(params, tx); // ✅ tx 전파
    this.logger.log(
      `EARN: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );
    return res;
  }

  /** 사용(REDEEM) */
  async redeem(params: RedeemParams, tx?: DbTx) {
    if (params.amount <= 0) throw new Error('사용 금액은 양수여야 합니다.');
    const balance = await this.repo.getBalance(params.partnerId);
    if (balance < params.amount) throw new Error('포인트가 부족합니다.');
    const res = await this.repo.redeem(params, tx); // ✅ tx 전파
    this.logger.log(
      `REDEEM: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );
    return res;
  }

  /** 적립 취소 (부분/전량) */
  async earnCancel(params: EarnCancelParams, tx?: DbTx) {
    const res = await this.repo.earnCancel(params, tx); // ✅ tx 전파
    this.logger.log(
      `EARN_CANCEL: partner=${params.partnerId} cancel=${res.cancel} event=${res.eventId}`,
    );
    return res;
  }
}

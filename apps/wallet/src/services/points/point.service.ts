// apps/wallet/src/services/point-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PointRepository,
  EarnParams,
  RedeemParams,
  EarnCancelParams,
} from './point.repository';

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
  async earn(params: EarnParams) {
    if (params.amount <= 0) throw new Error('적립 금액은 양수여야 합니다.');
    const res = await this.repo.earn(params);
    this.logger.log(
      `EARN: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );
    return res;
  }

  /** 사용(REDEEM) */
  async redeem(params: RedeemParams) {
    if (params.amount <= 0) throw new Error('사용 금액은 양수여야 합니다.');
    const balance = await this.repo.getBalance(params.partnerId);
    if (balance < params.amount) throw new Error('포인트가 부족합니다.');
    const res = await this.repo.redeem(params);
    this.logger.log(
      `REDEEM: partner=${params.partnerId} amount=${params.amount} event=${res.eventId}`,
    );
    return res;
  }

  /** 적립 취소 (부분/전량) */
  async earnCancel(params: EarnCancelParams) {
    const res = await this.repo.earnCancel(params);
    this.logger.log(
      `EARN_CANCEL: partner=${params.partnerId} cancel=${res.cancel} event=${res.eventId}`,
    );
    return res;
  }
}

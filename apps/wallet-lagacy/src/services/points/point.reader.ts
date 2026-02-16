import { Injectable } from '@nestjs/common';
import { PointRepository, PointHistoryItem } from './point.repository';


/**
 * PointReader (Implementation Layer)
 *
 * 책임: Point 조회 (레이어 규칙 준수)
 */
@Injectable()
export class PointReader {
  constructor(private readonly repo: PointRepository) { }

  async getBalance(partnerId: string): Promise<number> {
    return await this.repo.getBalance(partnerId);
  }

  async getWithdrawable(partnerId: string, now?: Date): Promise<number> {
    return await this.repo.getWithdrawable(partnerId, now);
  }

  async getHistory(
    partnerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointHistoryItem[]; total: number }> {
    return await this.repo.getHistory(partnerId, limit, offset);
  }
}


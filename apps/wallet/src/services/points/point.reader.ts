import { Injectable } from '@nestjs/common';
import { PointRepository } from './point.repository';

/**
 * PointReader (Implementation Layer)
 *
 * 책임: Point 조회 (레이어 규칙 준수)
 */
@Injectable()
export class PointReader {
  constructor(private readonly repo: PointRepository) {}

  async getBalance(partnerId: string): Promise<number> {
    return await this.repo.getBalance(partnerId);
  }

  async getWithdrawable(partnerId: string, now?: Date): Promise<number> {
    return await this.repo.getWithdrawable(partnerId, now);
  }
}

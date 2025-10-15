import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../shared/schemas/entities/schema';
import * as schema from '../shared/schemas/entities/schema';
import { eq, asc } from 'drizzle-orm';

export interface CancellationReason {
  code: string;
  displayText: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CancellationReasonService {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 활성화된 취소 이유 목록 조회
   */
  async getActiveReasons(): Promise<CancellationReason[]> {
    const reasons = await this.dbService.db
      .select()
      .from(schema.cancellationReasons)
      .where(eq(schema.cancellationReasons.isActive, true))
      .orderBy(asc(schema.cancellationReasons.sortOrder));

    return reasons;
  }

  /**
   * 취소 이유 코드로 조회
   */
  async getReasonByCode(code: string): Promise<CancellationReason | null> {
    const [reason] = await this.dbService.db
      .select()
      .from(schema.cancellationReasons)
      .where(eq(schema.cancellationReasons.code, code))
      .limit(1);

    return reason || null;
  }
}

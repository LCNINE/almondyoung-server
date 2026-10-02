import { Injectable } from '@nestjs/common';
import { BenefitUsageKind } from './benefit-usage';
import { BenefitUsageManager, BenefitUsageResult } from './benefit-usage.manager';

@Injectable()
export class BenefitUsageService {
  constructor(private readonly manager: BenefitUsageManager) {}

  async recordUsage(userId: string, kind: BenefitUsageKind, acknowledged: boolean): Promise<BenefitUsageResult> {
    return this.manager.recordUsage(userId, kind, acknowledged);
  }
}

import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import { reviewRewardPolicies, type UgcServiceSchema } from '../../db/schema';

type DbTransaction = Parameters<Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]>[0];

export interface RewardCalculationResult {
  reviewType: 'TEXT' | 'PHOTO';
  amount: number;
}

@Injectable()
export class ReviewRewardPolicyService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  async getActivePolicies(tx?: DbTransaction) {
    const runner = tx ?? this.client;
    return runner
      .select({
        reviewType: reviewRewardPolicies.reviewType,
        rewardAmount: reviewRewardPolicies.rewardAmount,
        minContentLength: reviewRewardPolicies.minContentLength,
        minMediaCount: reviewRewardPolicies.minMediaCount,
      })
      .from(reviewRewardPolicies)
      .where(eq(reviewRewardPolicies.active, true))
      .orderBy(desc(reviewRewardPolicies.priority));
  }

  async calculateReward(
    contentLength: number,
    mediaCount: number,
    tx?: DbTransaction,
  ): Promise<RewardCalculationResult | null> {
    const policies = await this.getActivePolicies(tx);

    if (policies.length === 0) {
      return null;
    }

    const reviewType: 'TEXT' | 'PHOTO' = mediaCount > 0 ? 'PHOTO' : 'TEXT';

    const matched = policies.find(
      (p) =>
        p.reviewType === reviewType &&
        contentLength >= p.minContentLength &&
        mediaCount >= p.minMediaCount,
    );

    if (!matched) {
      return null;
    }

    return { reviewType, amount: matched.rewardAmount };
  }
}

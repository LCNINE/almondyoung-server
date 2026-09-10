import { ReviewEligibilityResponseDto } from './dto/review-eligibility-response.dto';
import { type ReviewEligibilityEntity } from './types';

export class ReviewPermissionMapper {
  static toEligibilityResponse(entity: ReviewEligibilityEntity): ReviewEligibilityResponseDto {
    return {
      id: entity.id,
      userId: entity.userId,
      productId: entity.productId,
      orderId: entity.orderId,
      orderLineId: entity.orderLineId,
      eligibleAt: entity.eligibleAt.toISOString(),
      expiresAt: entity.expiresAt.toISOString(),
      consumedAt: entity.consumedAt?.toISOString() ?? null,
      consumedByReviewId: entity.consumedByReviewId ?? null,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}

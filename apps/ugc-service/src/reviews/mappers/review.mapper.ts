import { CommentResponseDto } from '../dto/comment-response.dto';
import { ReviewEligibilityResponseDto } from '../dto/review-eligibility-response.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';
import { type ReviewCommentEntity, type ReviewEligibilityEntity, type ReviewWithMediaEntity } from '../types';

export class ReviewMapper {
  static toResponse(entity: ReviewWithMediaEntity): ReviewResponseDto {
    return {
      id: entity.id,
      userId: entity.userId ?? null,
      productId: entity.productId,
      rating: entity.rating,
      content: entity.content,
      legacy_author_name: entity.legacyAuthorName ?? null,
      mediaFileIds: entity.mediaFileIds,
      helpfulCount: entity.helpfulCount,
      likeCount: entity.likeCount,
      dislikeCount: entity.dislikeCount,
      status: entity.status,
      deletedAt: entity.deletedAt?.toISOString() ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      adminComment: entity.adminComment ? ReviewMapper.toCommentResponse(entity.adminComment) : null,
    };
  }

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

  static toCommentResponse(entity: ReviewCommentEntity): CommentResponseDto {
    return {
      id: entity.id,
      reviewId: entity.reviewId,
      adminUserId: entity.adminUserId,
      content: entity.content,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

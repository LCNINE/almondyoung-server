import { CommentResponseDto } from '../dto/comment-response.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';
import { type ReviewCommentEntity, type ReviewWithMediaEntity } from '../types';

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
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      adminComment: entity.adminComment ? ReviewMapper.toCommentResponse(entity.adminComment) : null,
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

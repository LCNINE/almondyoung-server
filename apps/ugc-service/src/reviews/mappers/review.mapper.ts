import { ReviewResponseDto } from '../dto/review-response.dto';
import { type ReviewWithMediaEntity } from '../types';

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
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

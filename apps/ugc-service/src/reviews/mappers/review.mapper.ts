import { ReviewResponseDto } from '../dto/review-response.dto';
import { type ReviewEntity } from '../types';

export class ReviewMapper {
  static toResponse(entity: ReviewEntity): ReviewResponseDto {
    return {
      id: entity.id,
      userId: entity.userId ?? null,
      productId: entity.productId,
      rating: entity.rating,
      content: entity.content,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

import type { PurchaseSatisfactionResponseDto } from '../dto/purchase-satisfaction-response.dto';
import type { PurchaseSatisfactionRow } from '../types';

export class PurchaseSatisfactionMapper {
  static toResponse(row: PurchaseSatisfactionRow): PurchaseSatisfactionResponseDto {
    return {
      id: row.id,
      orderId: row.orderId,
      orderDisplayId: row.orderDisplayId,
      userId: row.userId,
      rating: row.rating,
      reasons: row.reasons,
      memo: row.memo,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      checkedBy: row.checkedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

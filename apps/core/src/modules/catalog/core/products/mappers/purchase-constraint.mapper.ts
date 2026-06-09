import type { PurchaseConstraintReadModel } from '../../../catalog.types';
import { PurchaseConstraintResponseDto } from '../dto/purchase-constraints';

export class PurchaseConstraintMapper {
  static toResponseDto(model: PurchaseConstraintReadModel): PurchaseConstraintResponseDto {
    return {
      id: model.id,
      requiresMembership: model.requiresMembership,
      lifetimeQuantityLimit: model.lifetimeQuantityLimit,
    };
  }
}

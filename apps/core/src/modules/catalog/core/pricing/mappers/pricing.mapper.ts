import { DateMapper } from '../../../common/mappers';
import { PricingRuleResponseDto } from '../dto/pricing-rule-response.dto';
import { PricingRuleEntity } from '../../../schema/catalog.schema.types';

/**
 * Mapper for Pricing DTOs
 * Handles Date to ISO 8601 string conversion
 */
export class PricingMapper {
  /**
   * Map entity to PricingRuleResponseDto
   */
  static toRuleDto(entity: PricingRuleEntity): PricingRuleResponseDto {
    return {
      id: entity.id,
      layer: entity.layer,
      order: entity.order,
      scopeType: entity.scopeType,
      scopeTargetIds: entity.scopeTargetIds,
      operationType: entity.operationType,
      operationValue: entity.operationValue,
      minQuantity: entity.minQuantity,
      createdAt: DateMapper.toNotNullString(entity.createdAt),
      updatedAt: DateMapper.toNotNullString(entity.updatedAt),
    };
  }

  /**
   * Map array of entities to PricingRuleResponseDto array
   */
  static toRuleDtoArray(entities: Array<PricingRuleEntity & { masterId?: string }>): PricingRuleResponseDto[] {
    return entities.map((e) => this.toRuleDto(e));
  }
}

import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';

export const PROMOTION_FIELDS = [
  'id', 'code', 'is_automatic', 'is_tax_inclusive', 'type', 'status',
  'campaign_id', 'created_at', 'updated_at', 'deleted_at',
  '*campaign', '*campaign.budget',
  '*application_method',
  '*application_method.target_rules',
  'application_method.target_rules.values.value',
  '*application_method.buy_rules',
  'application_method.buy_rules.values.value',
  'rules.id', 'rules.attribute', 'rules.operator', 'rules.values.value',
];

export function toMetadataShape(record: any): Record<string, unknown> | null {
  if (!record) return null;
  const result: Record<string, unknown> = {};
  if (record.name != null) result.name = record.name;
  if (record.max_discount_amount != null) result.max_discount_amount = record.max_discount_amount;
  if (record.max_uses_per_customer != null) result.max_uses_per_customer = record.max_uses_per_customer;
  if (record.created_by != null) result.created_by = record.created_by;
  return Object.keys(result).length > 0 ? result : null;
}

export async function fetchPromotionWithMeta(id: string, scope: any) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = scope.resolve(PROMOTION_META_MODULE);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: PROMOTION_FIELDS,
    filters: { $or: [{ id }, { code: id }] },
  });

  if (!promotions?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion with id or code: ${id} was not found`);
  }

  const promotion = (promotions as any[])[0];
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  return { ...promotion, metadata: toMetadataShape(meta) };
}

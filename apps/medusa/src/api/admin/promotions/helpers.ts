import { ContainerRegistrationKeys, MedusaError, remoteQueryObjectFromString } from '@medusajs/framework/utils';
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

const META_KEYS = ['name', 'max_discount_amount', 'max_uses_per_customer', 'created_by'] as const;

export function extractMetaFromAdditionalData(
  additional_data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!additional_data) return null;
  const result: Record<string, unknown> = {};
  for (const key of META_KEYS) {
    if (additional_data[key] != null) result[key] = additional_data[key];
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function toMetadataShape(record: any): Record<string, unknown> | null {
  if (!record) return null;
  const result: Record<string, unknown> = {};
  if (record.name != null) result.name = record.name;
  if (record.max_discount_amount != null) result.max_discount_amount = record.max_discount_amount;
  if (record.max_uses_per_customer != null) result.max_uses_per_customer = record.max_uses_per_customer;
  if (record.created_by != null) result.created_by = record.created_by;
  return Object.keys(result).length > 0 ? result : null;
}

async function remoteQueryPromotions(
  scope: any,
  variables: Record<string, unknown>,
  fields: string[] = PROMOTION_FIELDS,
): Promise<any[]> {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: 'promotion',
    variables,
    fields,
  });
  return remoteQuery(queryObject);
}

export async function fetchPromotionWithMeta(id: string, scope: any, fields?: string[]) {
  const promotionMetaService = scope.resolve(PROMOTION_META_MODULE);

  const promotions = await remoteQueryPromotions(
    scope,
    { filters: { $or: [{ id }, { code: id }] } },
    fields,
  );

  if (!promotions?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion with id or code: ${id} was not found`);
  }

  const promotion = promotions[0];
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  return { ...promotion, metadata: toMetadataShape(meta) };
}

export { remoteQueryPromotions };

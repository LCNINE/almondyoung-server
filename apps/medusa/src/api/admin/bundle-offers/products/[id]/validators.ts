import { z } from 'zod';

const offer = z.object({
  addon_pim_master_id: z.string().min(1),
  allowed_pim_variant_ids: z.array(z.string().min(1)).min(1).nullable(),
  regular_rate_bp: z.number().int().min(0).max(9900),
  membership_rate_bp: z.number().int().min(0).max(9900),
  enabled: z.boolean(),
  starts_at: z.string().datetime().nullable(),
  ends_at: z.string().datetime().nullable(),
  label: z.string().max(40).nullable(),
  sort: z.number().int().min(0),
});

export const AdminBundleOfferSync = z.object({
  pim_master_id: z.string().min(1),
  offers: z.array(offer).max(5),
  // core 저장 시각. 더 늦은 교체가 이미 적용됐으면 이 요청은 건너뛴다
  changed_at: z.string().datetime().optional(),
});

export type AdminBundleOfferSyncType = z.infer<typeof AdminBundleOfferSync>;

import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { randomBytes } from 'crypto';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';

type CreateEventBody = {
  title?: string;
  description?: string | null;
  banner_image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: 'draft' | 'active' | 'ended';
  promotion_ids?: string[];
};

async function generateUniqueSlug(service: PromotionMetaModuleService): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomBytes(4).toString('hex');
    const existing = await service.getEventBySlug(slug);
    if (!existing) return slug;
  }
  throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, 'Failed to generate a unique slug');
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const [events, allItems] = await Promise.all([
    (service as any).listCouponEvents({}, { order: { created_at: 'DESC' } }),
    (service as any).listCouponEventItems({}),
  ]);

  const countByEvent = new Map<string, number>();
  for (const item of allItems as any[]) {
    countByEvent.set(item.event_id, (countByEvent.get(item.event_id) ?? 0) + 1);
  }

  return res.status(200).json({
    events: (events as any[]).map((e) => ({ ...e, item_count: countByEvent.get(e.id) ?? 0 })),
    count: (events as any[]).length,
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const body = req.body as CreateEventBody;

  if (!body.title?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'title is required');
  }

  const slug = await generateUniqueSlug(service);

  const [event] = await (service as any).createCouponEvents([
    {
      slug,
      title: body.title.trim(),
      description: body.description ?? null,
      banner_image_url: body.banner_image_url ?? null,
      starts_at: body.starts_at ?? null,
      ends_at: body.ends_at ?? null,
      status: body.status ?? 'draft',
    },
  ]);

  if (body.promotion_ids?.length) {
    await service.setEventItems(event.id, body.promotion_ids);
  }

  return res.status(201).json({ event });
}

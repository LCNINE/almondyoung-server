import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';

type UpdateEventBody = {
  title?: string;
  description?: string | null;
  banner_image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: 'draft' | 'active' | 'ended';
  promotion_ids?: string[];
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const eventId = req.params.id;

  const events = await (service as any).listCouponEvents({ id: eventId });
  const event = events[0];
  if (!event) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Coupon event ${eventId} not found`);
  }

  const items = await service.listEventItems(eventId);
  const promotionIds = items.map((i: any) => i.promotion_id);

  let promotions: any[] = [];
  if (promotionIds.length > 0) {
    const { data } = await query.graph({
      entity: 'promotion',
      fields: ['id', 'code', 'status', 'application_method.type', 'application_method.value'],
      filters: { id: promotionIds },
    });
    promotions = data as any[];
  }
  const promoById = new Map(promotions.map((p) => [p.id, p]));

  return res.status(200).json({
    event,
    items: items.map((i: any) => ({
      promotion_id: i.promotion_id,
      sort_order: i.sort_order,
      promotion: promoById.get(i.promotion_id) ?? null,
    })),
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const eventId = req.params.id;
  const body = req.body as UpdateEventBody;

  const events = await (service as any).listCouponEvents({ id: eventId });
  if (!events[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Coupon event ${eventId} not found`);
  }

  const patch: Record<string, unknown> = { id: eventId };
  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.banner_image_url !== undefined) patch.banner_image_url = body.banner_image_url;
  if (body.starts_at !== undefined) patch.starts_at = body.starts_at;
  if (body.ends_at !== undefined) patch.ends_at = body.ends_at;
  if (body.status !== undefined) patch.status = body.status;

  await (service as any).updateCouponEvents(patch);

  if (body.promotion_ids !== undefined) {
    await service.setEventItems(eventId, body.promotion_ids);
  }

  const [event] = await (service as any).listCouponEvents({ id: eventId });
  return res.status(200).json({ event });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const eventId = req.params.id;

  await service.setEventItems(eventId, []); // 항목 정리
  await (service as any).deleteCouponEvents([eventId]);

  return res.status(200).json({ id: eventId, deleted: true });
}

import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { BUNDLE_OFFER_MODULE } from '../../modules/bundle-offer';
import type BundleOfferModuleService from '../../modules/bundle-offer/service';
import { isStaleBundleOfferSync, planBundleOfferSync, type AddonProduct, type BundleOfferRow, type BundleOfferSyncItem, type BundleOfferSyncPlan } from './rules';

type ProductRow = { id: string; handle: string; variants?: Array<{ id: string; metadata?: Record<string, unknown> | null }> | null };

/** 상품(A)이 있는지 보고, 구성품(B)을 handle(= PIM master id)로 찾아 쇼핑몰 id 로 바꾼 계획을 만든다. */
export const prepareBundleOfferSyncStep = createStep(
  'prepare-bundle-offer-sync',
  async (input: { product_id: string; offers: BundleOfferSyncItem[] }, { container }): Promise<StepResponse<BundleOfferSyncPlan>> => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: products } = await query.graph({ entity: 'product', fields: ['id'], filters: { id: input.product_id } });
    if (products.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${input.product_id} not found`);
    }

    const handles = [...new Set(input.offers.map((o) => o.addon_pim_master_id))];
    const addons = new Map<string, AddonProduct>();
    if (handles.length > 0) {
      const { data } = await query.graph({
        entity: 'product',
        fields: ['id', 'handle', 'variants.id', 'variants.metadata'],
        filters: { handle: handles },
      });
      for (const p of data as ProductRow[]) {
        addons.set(p.handle, {
          id: p.id,
          handle: p.handle,
          variants: (p.variants ?? []).map((v) => ({
            id: v.id,
            pim_variant_id: typeof v.metadata?.pimVariantId === 'string' ? v.metadata.pimVariantId : null,
          })),
        });
      }
    }
    return new StepResponse(planBundleOfferSync(input.product_id, input.offers, addons));
  },
);

type ReplaceCompensation = {
  created: string[];
  removed: string[];
  revision: { id: string; changed_at: Date } | { created: string } | null;
};

/** 상품의 구성품 행을 통째로 바꾼다. 뒤 스텝이 실패하면 새 행을 지우고 옛 행을 되살린다. */
export const replaceBundleOffersStep = createStep(
  'replace-bundle-offers',
  async (input: { product_id: string; rows: BundleOfferRow[]; changed_at?: string }, { container }) => {
    const service = container.resolve<BundleOfferModuleService>(BUNDLE_OFFER_MODULE);
    const [revision] = await service.listBundleOfferRevisions({ product_id: input.product_id });
    const storedAt = revision ? new Date(revision.changed_at) : null;
    if (isStaleBundleOfferSync(input.changed_at, storedAt)) {
      return new StepResponse({ stale: true }, { created: [], removed: [], revision: null } satisfies ReplaceCompensation);
    }
    const existing = await service.listBundleOffers({ product_id: input.product_id }, { select: ['id'] });
    const removed = existing.map((r) => r.id);
    if (removed.length > 0) await service.softDeleteBundleOffers(removed);
    let created: Awaited<ReturnType<BundleOfferModuleService['createBundleOffers']>> = [];
    let revisionUndo: ReplaceCompensation['revision'] = null;
    try {
      if (input.rows.length > 0) created = await service.createBundleOffers(input.rows);
      if (input.changed_at) {
        const changedAt = new Date(input.changed_at);
        if (revision && storedAt) {
          await service.updateBundleOfferRevisions({ id: revision.id, changed_at: changedAt });
          revisionUndo = { id: revision.id, changed_at: storedAt };
        } else if (!revision) {
          const createdRevision = await service.createBundleOfferRevisions({ product_id: input.product_id, changed_at: changedAt });
          revisionUndo = { created: createdRevision.id };
        }
      }
    } catch (error) {
      // 이 단계가 결과를 못 돌려주면 보상은 입력 없이 불린다 — 여기서 원래대로 돌리고 다시 던진다
      if (created.length > 0) await service.deleteBundleOffers(created.map((r) => r.id));
      if (removed.length > 0) await service.restoreBundleOffers(removed);
      throw error;
    }
    return new StepResponse({ stale: false }, { created: created.map((r) => r.id), removed, revision: revisionUndo } satisfies ReplaceCompensation);
  },
  async (compensation: ReplaceCompensation | undefined, { container }) => {
    if (!compensation) return;
    const service = container.resolve<BundleOfferModuleService>(BUNDLE_OFFER_MODULE);
    if (compensation.created.length > 0) await service.deleteBundleOffers(compensation.created);
    if (compensation.removed.length > 0) await service.restoreBundleOffers(compensation.removed);
    const revision = compensation.revision;
    if (revision && 'created' in revision) await service.deleteBundleOfferRevisions(revision.created);
    else if (revision) await service.updateBundleOfferRevisions({ id: revision.id, changed_at: revision.changed_at });
  },
);

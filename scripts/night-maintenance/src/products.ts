import { isDeepStrictEqual } from 'node:util';
import { emptyApprovedFields } from './policy';
import { RunControls, StateStore } from './ports';

interface ProductVariant {
  variantCode?: string | null;
  variantName?: string | null;
  status?: string;
  displayOrder?: number;
  priceSet?: unknown;
  optionValues?: Array<{ displayName?: string }>;
}

export interface ProductVersion {
  id: string;
  status: string;
  productInfo?: Record<string, string>;
  variants?: ProductVariant[];
  categories?: Array<{ categoryId?: string; id?: string }>;
  images?: Array<{ fileId?: string; isPrimary?: boolean; sortOrder?: number }>;
  [key: string]: unknown;
}

export interface ProductProposal {
  masterId: string;
  name: string;
  expectedActiveVersionId: string;
  setProductInfo: Record<string, string>;
}

export interface ProductDependencies extends RunControls {
  api: {
    current(masterId: string): Promise<ProductVersion>;
    draft(masterId: string, draftId: string): Promise<ProductVersion>;
    create(masterId: string, parentId: string): Promise<ProductVersion>;
    update(masterId: string, draftId: string, productInfo: Record<string, string>): Promise<ProductVersion>;
    publish(masterId: string, versionId: string, expectedActiveVersionId: string): Promise<void>;
  };
  store: StateStore;
}

interface ProductProgress {
  phase: 'create-intent' | 'draft-created' | 'update-intent' | 'updated' | 'publish-intent' | 'verified';
  before: ProductVersion;
  fields: Record<string, string>;
  draftId?: string;
}

const SCALARS = [
  'name',
  'description',
  'descriptionHtml',
  'brand',
  'thumbnail',
  'productCode',
  'material',
  'isWholesaleOnly',
  'isMembershipOnly',
  'hideMembershipPriceForNonMembers',
  'isVisibleToMembersOnly',
  'isOverseas',
  'fulfillmentKind',
  'productType',
  'shippingMethodId',
  'shippingGroupCode',
  'marketPrice',
  'supplyPrice',
  'supplierId',
  'ageRestriction',
  'minQuantity',
  'maxQuantity',
  'salesStartDate',
  'salesEndDate',
  'seoTitle',
  'seoDescription',
  'seoKeywords',
  'alternativeName',
  'salesClassification',
  'purchaseClassification',
];

function sorted<T>(values: T[]): T[] {
  return values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function semantics(product: ProductVersion, prices: boolean) {
  return JSON.parse(
    JSON.stringify({
      scalar: Object.fromEntries(SCALARS.map((key) => [key, product[key]])),
      categories: (product.categories ?? []).map((category) => category.categoryId ?? category.id).sort(),
      images: sorted(
        (product.images ?? []).map((image) => ({
          fileId: image.fileId,
          isPrimary: image.isPrimary,
          sortOrder: image.sortOrder,
        })),
      ),
      variants: sorted(
        (product.variants ?? []).map((variant) => ({
          variantCode: variant.variantCode,
          variantName: variant.variantName,
          status: variant.status,
          displayOrder: variant.displayOrder,
          priceSet: prices ? variant.priceSet : undefined,
          options: (variant.optionValues ?? []).map((option) => option.displayName).sort(),
        })),
      ),
    }),
  );
}

function verify(product: ProductVersion, state: ProductProgress, prices: boolean): void {
  if (!isDeepStrictEqual(semantics(product, prices), semantics(state.before, prices))) {
    throw new Error('Unrelated product fields changed');
  }

  if (!isDeepStrictEqual(product.productInfo ?? {}, { ...state.before.productInfo, ...state.fields })) {
    throw new Error('Product metadata verification failed');
  }
}

async function processProduct(
  proposal: ProductProposal,
  deps: ProductDependencies,
): Promise<'verified' | 'already-verified' | 'skipped'> {
  const key = `products/${proposal.masterId}.json`;
  let state = await deps.store.read<ProductProgress>(key);
  let current = await deps.api.current(proposal.masterId);

  if (state?.phase === 'verified') {
    if (current.id !== state.draftId) return 'skipped';
    verify(current, state, true);

    return 'already-verified';
  }
  if (!state) {
    if (current.status !== 'active' || current.id !== proposal.expectedActiveVersionId) return 'skipped';
    const fields = emptyApprovedFields(current.productInfo ?? {}, proposal.setProductInfo);
    if (!Object.keys(fields).length) return 'skipped';

    state = { phase: 'create-intent', before: current, fields };
    await deps.store.write(key, state);
    await deps.checkWrite();
    const draft = await deps.api.create(proposal.masterId, current.id);
    if (draft.status !== 'draft') throw new Error('Created version is not a draft');
    state.draftId = draft.id;
    state.phase = 'draft-created';
    await deps.store.write(key, state);
  } else if (state.phase === 'create-intent' && !state.draftId) {
    throw new Error('Unresolved draft creation; operator reconciliation required');
  }

  if (!state.draftId) throw new Error('Missing owned draft');
  if (current.id !== state.before.id && current.id !== state.draftId)
    throw new Error('Active version changed during owned operation');

  let publicationError: unknown;
  if (current.id !== state.draftId) {
    if (state.phase === 'publish-intent')
      throw new Error('Unresolved previous publish; refusing duplicate publication');

    if (state.phase === 'update-intent') {
      const draft = await deps.api.draft(proposal.masterId, state.draftId);
      verify(draft, state, false);
      state.phase = 'updated';
      await deps.store.write(key, state);
    }
    if (state.phase === 'draft-created') {
      const ownedDraft = await deps.api.draft(proposal.masterId, state.draftId);
      if (
        !isDeepStrictEqual(semantics(ownedDraft, false), semantics(state.before, false)) ||
        !isDeepStrictEqual(ownedDraft.productInfo ?? {}, state.before.productInfo ?? {})
      ) {
        throw new Error('Owned draft changed before metadata update');
      }
      state.phase = 'update-intent';
      await deps.store.write(key, state);
      await deps.checkWrite();
      const draft = await deps.api.update(proposal.masterId, state.draftId, {
        ...state.before.productInfo,
        ...state.fields,
      });
      verify(draft, state, false);
      state.phase = 'updated';
      await deps.store.write(key, state);
    }

    const readyDraft = await deps.api.draft(proposal.masterId, state.draftId);
    if (readyDraft.status !== 'draft') throw new Error('Owned draft is no longer a draft');
    verify(readyDraft, state, false);

    current = await deps.api.current(proposal.masterId);
    if (current.id !== state.before.id) throw new Error('Concurrent active change before publish');
    state.phase = 'publish-intent';
    await deps.store.write(key, state);
    await deps.checkWrite();

    try {
      await deps.api.publish(proposal.masterId, state.draftId, state.before.id);
    } catch (error) {
      // The HTTP response is not proof that the transaction failed; never repeat publication.
      const observed = await deps.api.current(proposal.masterId);
      if (observed.id !== state.draftId) throw error;
      publicationError = error;
    }
  }

  const after = await deps.api.current(proposal.masterId);
  if (after.id !== state.draftId || after.status !== 'active')
    throw new Error('Published version did not become active');
  verify(after, state, true);
  state.phase = 'verified';
  await deps.store.write(key, state);
  deps.log({ masterId: proposal.masterId, phase: 'product-info-verified', fields: Object.keys(state.fields) });

  if (publicationError) throw publicationError;
  return 'verified';
}

export async function runProducts(proposals: ProductProposal[], deps: ProductDependencies) {
  const ids = new Set(proposals.map((proposal) => proposal.masterId));
  if (ids.size !== proposals.length) throw new Error('Duplicate product proposal IDs');
  proposals.forEach((proposal) => emptyApprovedFields({}, proposal.setProductInfo));
  await deps.checkLoad();

  if (deps.dryRun) {
    for (const proposal of proposals.slice(0, 5)) await deps.api.current(proposal.masterId);
    return { status: 'dry-run', candidates: proposals.length, sampled: Math.min(5, proposals.length) };
  }

  let verified = 0;
  let skipped = 0;
  let pacedCandidates = 0;

  for (let index = 0; index < proposals.length; index++) {
    if (!deps.canWrite()) break;
    await deps.checkWrite();
    await deps.checkLoad();
    const result = await processProduct(proposals[index], deps);

    if (result === 'already-verified') {
      verified++;

      continue;
    }

    if (result === 'verified') verified++;
    else skipped++;

    pacedCandidates++;
    await deps.sleep(5000);

    if (pacedCandidates % 20 === 0 && index + 1 < proposals.length) {
      await deps.sleep(300000);
    }
  }

  const remaining = proposals.length - verified - skipped;
  return { status: remaining || skipped ? 'partial' : 'complete', verified, skipped, remaining };
}

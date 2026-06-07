# Product Draft Editing Flow Backlog

## Context

Core Catalog treats a saleable product as a product master with versioned product data. A new product is not created as one complete form submission. The registration entrypoint creates a new master and an initial draft version, then the operator completes the draft through version-scoped editing surfaces before publishing it.

Relevant domain rules are recorded in `CONTEXT.md`:

- Product registration opens a new master and initial draft version.
- Prices are managed by the pricing module as version-scoped rules, not scalar fields on the product form.
- The draft completion checklist is advisory only. It must not become a publish gate.
- Publish hard gates remain server-owned validations such as version status, variant code conflicts, and price calculation validity.

## Target Flow

1. Operator opens `apps/admin-web` route `/mall/product-registration`.
2. Page explains that continuing will create a new product master and draft version.
3. Operator clicks `새 상품 생성하기`.
4. Admin web calls Core `POST /masters` with no meaningful body.
5. Core returns the created draft version. The response `id` is the version ID and `masterId` is the product master ID.
6. Admin web navigates to `/mall/products-list/{masterId}?versionId={versionId}`.
7. The destination page acts as the draft editing hub and shows an advisory completion checklist.

## Backlog Slices

### 1. Replace Product Registration Form With Draft Creation Entry

**Goal:** Remove the misleading one-shot product registration form and replace it with a simple draft creation entrypoint.

**Primary files:**

- Modify `apps/admin-web/src/app/(admin)/mall/product-registration/(components)/product-registration.client.tsx`
- Modify `apps/admin-web/src/lib/api/domains/products/masters.client.ts`
- Modify `apps/admin-web/src/lib/services/products/mutations.ts`
- Modify `apps/admin-web/src/lib/types/dto/products.ts`

**Scope:**

- Remove the large product form from `/mall/product-registration`.
- Render explanatory copy and one primary action: `새 상품 생성하기`.
- Call `products.masters.create()` without user-entered fields.
- On success, navigate to `/mall/products-list/${masterId}?versionId=${id}`.
- Show pending and error states.

**Acceptance checks:**

- The page no longer shows price, purchase-condition, option, image, or product metadata fields.
- The create button is disabled while the mutation is pending.
- A successful Core response with `{ id, masterId }` navigates to the draft detail URL.
- No product price fields are sent in the create request.

**Suggested verification:**

- `yarn lint`
- A focused component/unit test if the app already has a pattern for route mutation pages.

### 2. Align Admin Product Creation Types With Core Contract

**Goal:** Stop the frontend from modeling `POST /masters` as a legacy full product create DTO.

**Primary files:**

- Modify `apps/admin-web/src/lib/types/dto/products.ts`
- Modify `apps/admin-web/src/lib/api/domains/products/masters.client.ts`
- Modify `apps/admin-web/src/lib/services/products/mutations.ts`

**Scope:**

- Replace or narrow `CreateMasterDto` so product creation has no required `name`, `basePrice`, or `pricingStrategy`.
- Add a response type that reflects Core `ProductDto` enough for creation redirect: `id`, `masterId`, `version`, `status`, `name`.
- Keep deprecated legacy types separate from the new create contract to avoid widening phantom fields.

**Acceptance checks:**

- `products.masters.create()` can be called without arguments.
- TypeScript no longer suggests `basePrice` or `pricingStrategy` for product creation.
- Existing product list/detail consumers still compile.

**Suggested verification:**

- `yarn build`
- `yarn lint`

### 3. Add Draft Editing Hub Checklist Shell

**Goal:** Make `/mall/products-list/{masterId}?versionId={draftVersionId}` clearly behave as a draft completion workspace.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/products-detail/template/index.tsx`
- Create or modify a component under `apps/admin-web/src/features/mall/products-detail/components/`
- Use existing hooks in `apps/admin-web/src/lib/services/products/use-product-detail.ts`
- Use existing pricing query hooks in `apps/admin-web/src/lib/services/products/queries.ts`

**Scope:**

- Show the checklist only when `data.source === 'version'` and `data.status === 'draft'`.
- Include advisory checklist items for basic info, images, options/variants, pricing rules, and publish readiness.
- Link each item to the relevant section or route.
- Link pricing to `/mall/pricing/${masterId}?versionId=${versionId}`.
- Do not block publish based on this checklist.

**Acceptance checks:**

- Active and inactive views do not show the new draft checklist.
- Draft views show the checklist near the top of the page.
- Checklist state is visibly advisory, not a validation failure list.
- Pricing item deep-links to the matching draft version in pricing management.

**Suggested verification:**

- `yarn lint`
- Manual route check for active, inactive, and draft version URLs.

### 4. Preserve Draft Versions In Version Navigation

**Goal:** Ensure draft versions are discoverable from the version tree and related navigation surfaces.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/product-versions-tree/lib/collapse.ts`
- Modify `apps/admin-web/src/features/mall/product-versions-tree/components/tree-graph.tsx`
- Modify `apps/admin-web/src/features/mall/product-versions-tree/components/version-node.tsx`
- Modify `apps/admin-web/src/features/mall/product-versions-tree/components/collapsed-chain-panel.tsx`

**Scope:**

- Include draft versions in the version tree.
- Visually distinguish draft, active, and inactive versions.
- Keep collapsed-chain behavior understandable when draft nodes are present.
- Preserve navigation to `/mall/products-list/${masterId}?versionId=${versionId}`.

**Acceptance checks:**

- A newly created draft version appears in version navigation.
- Draft nodes do not appear as active/inactive.
- Clicking a draft node opens the draft detail view.

**Suggested verification:**

- `yarn lint`
- Unit tests for `collapseTree` if the current helper is covered or easy to cover.

### 5. Add Basic Information Editing

**Goal:** Allow draft versions to edit scalar product version fields from the detail page.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/products-detail/components/general/index.tsx`
- Modify `apps/admin-web/src/lib/services/products/products-detail.types.ts`
- Modify `apps/admin-web/src/lib/services/products/mutations.ts` if mutation typing needs expansion

**Scope:**

- Expose edit action only for draft versions.
- Edit fields such as `name`, `brand`, `isWholesaleOnly`, `isMembershipOnly`, SEO fields, and category selection.
- Use `PUT /masters/:masterId/versions/:versionId`.
- Keep active and inactive views read-only.

**Acceptance checks:**

- Draft detail page can update name and brand.
- Active detail page has no direct edit action for these fields.
- Successful save invalidates version detail, master detail, and version tree queries.

**Suggested verification:**

- `yarn lint`
- Focused mutation test if an existing product detail test pattern exists.

### 6. Add Image Editing

**Goal:** Allow draft versions to manage representative and additional product images.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/products-detail/components/images/index.tsx`
- Reuse existing file upload APIs/components where available
- Modify `apps/admin-web/src/lib/services/products/products-detail.types.ts`

**Scope:**

- Expose image edit action only for draft versions.
- Support `thumbnailFileId` and `additionalImageFileIds`.
- Keep the maximum of five additional images aligned with Core validation.
- Refresh the image display after save.

**Acceptance checks:**

- Draft detail page can set or clear the primary image.
- Draft detail page can replace additional images.
- Active and inactive image cards remain read-only.

**Suggested verification:**

- `yarn lint`
- Manual upload flow against local file-service if automated coverage is not available.

### 7. Add Option Editing

**Goal:** Provide a safe editing surface for option groups and values.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/products-detail/components/options/index.tsx`
- Modify `apps/admin-web/src/lib/services/products/products-detail.types.ts`
- Possibly add option form components under `apps/admin-web/src/features/mall/products-detail/components/options/`

**Scope:**

- Expose option edit action only for draft versions.
- Use `optionDiff` through `PUT /masters/:masterId/versions/:versionId`.
- Warn that option structure changes can regenerate variants.
- Prefer a full-screen or large dialog because option editing affects variant topology.

**Acceptance checks:**

- Draft detail page can add an option group with values.
- Variant table refreshes after option changes.
- Active and inactive option cards remain read-only.

**Suggested verification:**

- `yarn lint`
- Manual option add/edit flow against Core.

### 8. Add Variant Editing

**Goal:** Support draft-scoped variant editing without breaking version isolation.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/products-detail/components/variants/index.tsx`
- Modify or add hooks in `apps/admin-web/src/lib/api/domains/products/versions.client.ts`
- Modify `apps/admin-web/src/lib/services/products/mutations.ts`

**Scope:**

- Use version-scoped variant endpoints: `PUT /masters/:masterId/versions/:versionId/variants/:variantId` and bulk endpoint.
- Expose row and bulk edit actions only for draft versions.
- Handle responses where copy-on-write changes the variant ID.
- Refresh version detail, pricing, and variant views after changes.

**Acceptance checks:**

- Draft variant names/status/display order can be edited.
- Active/inactive variant tables are read-only.
- If the backend returns a new variant ID, the UI refreshes from server state rather than assuming the old ID is still current.

**Suggested verification:**

- `yarn lint`
- Manual edit flow that starts from a draft copied from an active version.

### 9. Tighten Pricing Management Deep Link

**Goal:** Make pricing management operate on the same draft version the operator selected in the detail page.

**Primary files:**

- Modify `apps/admin-web/src/features/mall/pricing-detail/template/index.tsx`
- Modify `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx`
- Modify relevant detail page links in `apps/admin-web/src/features/mall/products-detail/`

**Scope:**

- Preserve `?versionId=` when navigating from a draft detail page to pricing management.
- If `versionId` is present and valid, select that version in the pricing page.
- Continue to use pricing page as the canonical price-rule editing surface.

**Acceptance checks:**

- From draft detail checklist, clicking pricing opens the pricing page with the same draft selected.
- Active product list price management continues to select the active version by default.
- Read-only behavior remains for active/inactive pricing rules.

**Suggested verification:**

- `yarn lint`
- Manual navigation from active list, active detail, and draft detail.

### 10. Add Publish And Draft Lifecycle UX

**Goal:** Provide clear lifecycle actions without turning advisory checklist items into publish blockers.

**Primary files:**

- Modify `apps/admin-web/src/lib/api/domains/products/versions.client.ts`
- Modify `apps/admin-web/src/lib/services/products/mutations.ts`
- Modify `apps/admin-web/src/features/mall/products-detail/template/index.tsx`
- Modify or create lifecycle action components under `apps/admin-web/src/features/mall/products-detail/components/`

**Scope:**

- Add publish action for draft/inactive versions.
- Add draft delete action for draft versions.
- Show server validation errors from publish clearly.
- Do not block publish based on advisory checklist completion.
- After publish, navigate to `/mall/products-list/${masterId}` or refresh into active view.

**Acceptance checks:**

- Draft detail page exposes publish and delete draft actions.
- Publish failure displays the backend error message.
- Advisory checklist incomplete state does not disable publish.
- Successful publish invalidates master, version tree, and list queries.

**Suggested verification:**

- `yarn lint`
- Manual publish attempt with valid and invalid pricing state.

## Non-Goals

- Do not recreate a single giant product registration form.
- Do not add scalar `basePrice`, `membershipPrice`, or `wholesalePrice` fields to product creation.
- Do not introduce new publish hard gates from the advisory checklist.
- Do not move pricing rule editing into the general product detail card.
- Do not edit active version rows directly.

## Suggested Execution Order

1. Product registration entrypoint and create contract.
2. Draft editing hub checklist and version navigation.
3. Basic information editing.
4. Pricing deep link cleanup.
5. Image editing.
6. Option editing.
7. Variant editing.
8. Publish and draft lifecycle actions.

This order removes the misleading registration form early, then incrementally turns the existing version detail route into the draft editing hub.

# Product Description Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement canonical Markdown product descriptions with file-service image directives, admin preview/edit support, and legacy HTML fallback while keeping Medusa `description` null/empty.

**Architecture:** Put the Markdown directive contract in a NestJS/React-free package, then build an admin-web React renderer/editor around that contract. Core already stores and copies `description`/`descriptionHtml`; this plan tightens API/client types and adds regression tests so active version content and Medusa projection rules do not drift.

**Tech Stack:** TypeScript, NestJS, Drizzle, Next.js admin-web, React 19, TanStack Query, `react-markdown`, `remark-gfm`, `remark-directive`, Jest.

---

## File Structure

- Create `packages/product-description/package.json`
  - Framework-independent package manifest for the shared product description contract.
- Create `packages/product-description/index.ts`
  - Public exports for directive constants and helpers.
- Create `packages/product-description/directive.ts`
  - Owns `::product-image{fileId="..." alt="..."}` parsing and string creation.
- Create `packages/product-description/directive.spec.ts`
  - Tests the directive contract without React or NestJS.
- Modify `tsconfig.json`
  - Add `@packages/product-description` path aliases.
- Modify `package.json`
  - Add Jest module mapper for `@packages/product-description`.
- Modify `apps/admin-web/tsconfig.json`
  - Add `@packages/product-description` path aliases for Next.js.
- Modify `apps/admin-web/package.json`
  - Add admin renderer dependencies: `react-markdown`, `remark-gfm`, `remark-directive`.
- Modify `apps/admin-web/src/lib/types/dto/products.ts`
  - Add `descriptionHtml` to product create/update DTOs where missing.
- Modify `apps/admin-web/src/lib/services/products/products-detail.types.ts`
  - Add `descriptionHtml` to `ProductMasterDetail`, `MasterVersionDetailDto`, and update-version DTO.
- Modify `apps/admin-web/src/lib/services/products/use-product-detail.ts`
  - Carry `descriptionHtml` through `ProductDetailView`.
- Modify `apps/admin-web/src/lib/api/domains/files/upload.client.ts`
  - Export `PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID`.
- Modify `apps/admin-web/src/lib/api/domains/products/versions.client.ts`
  - Add `update(masterId, versionId, dto)`.
- Modify `apps/admin-web/src/lib/services/products/mutations.ts`
  - Add `useUpdateMasterVersion`.
- Create `apps/admin-web/src/features/mall/products-detail/components/description/product-description-markdown.tsx`
  - React Markdown renderer with product image directive support and admin placeholder behavior.
- Create `apps/admin-web/src/features/mall/products-detail/components/description/product-description-image.tsx`
  - Product image component that maps file IDs to file-service public URLs and shows broken-reference placeholders.
- Create `apps/admin-web/src/features/mall/products-detail/components/description/markdown-image-upload-button.tsx`
  - Uploads to `product-description-image` and inserts the directive into the textarea.
- Create `apps/admin-web/src/features/mall/products-detail/components/description/index.tsx`
  - Product detail card: Markdown editor for draft versions, Markdown preview, legacy HTML read-only preview.
- Modify `apps/admin-web/src/features/mall/products-detail/template/index.tsx`
  - Add the product description card to the product detail page.
- Modify `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts`
  - Assert Core `description`/`descriptionHtml` are not projected to Medusa `description`.
- Create `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts`
  - Mapper regression test for `description` and `descriptionHtml` response fields.

## Task 1: Shared Product Description Contract

**Files:**
- Create: `packages/product-description/package.json`
- Create: `packages/product-description/index.ts`
- Create: `packages/product-description/directive.ts`
- Create: `packages/product-description/directive.spec.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Add a failing directive contract test**

Create `packages/product-description/directive.spec.ts`:

```ts
import {
  createProductImageDirective,
  parseProductImageDirective,
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  PRODUCT_IMAGE_DIRECTIVE_NAME,
} from './directive';

describe('product description image directive', () => {
  const fileId = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';

  it('defines the file-service context and directive name', () => {
    expect(PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID).toBe('product-description-image');
    expect(PRODUCT_IMAGE_DIRECTIVE_NAME).toBe('product-image');
  });

  it('parses a valid product-image directive node', () => {
    const result = parseProductImageDirective({
      type: 'leafDirective',
      name: 'product-image',
      attributes: { fileId, alt: '상세 이미지' },
    });

    expect(result).toEqual({
      ok: true,
      fileId,
      alt: '상세 이미지',
    });
  });

  it('rejects nodes with a different directive name', () => {
    const result = parseProductImageDirective({
      type: 'leafDirective',
      name: 'image',
      attributes: { fileId },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'not_product_image_directive',
    });
  });

  it('rejects a missing or invalid fileId', () => {
    expect(
      parseProductImageDirective({
        type: 'leafDirective',
        name: 'product-image',
        attributes: {},
      }),
    ).toEqual({ ok: false, reason: 'missing_file_id' });

    expect(
      parseProductImageDirective({
        type: 'leafDirective',
        name: 'product-image',
        attributes: { fileId: 'https://example.com/image.png' },
      }),
    ).toEqual({ ok: false, reason: 'invalid_file_id' });
  });

  it('creates a markdown directive string with escaped alt text', () => {
    expect(createProductImageDirective({ fileId, alt: '12" nail \\ sample' })).toBe(
      '::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="12\\" nail \\\\ sample"}',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
yarn jest packages/product-description/directive.spec.ts --runInBand
```

Expected: FAIL because `packages/product-description/directive.ts` does not exist.

- [ ] **Step 3: Create the package manifest**

Create `packages/product-description/package.json`:

```json
{
  "name": "@packages/product-description",
  "version": "0.0.1",
  "description": "Framework-independent product description Markdown contract",
  "private": true,
  "main": "index.ts",
  "types": "index.ts"
}
```

- [ ] **Step 4: Implement the directive contract**

Create `packages/product-description/directive.ts`:

```ts
export const PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID = 'product-description-image';
export const PRODUCT_IMAGE_DIRECTIVE_NAME = 'product-image';

export type ProductImageDirectiveNode = {
  type?: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
};

export type ProductImageReference = {
  fileId: string;
  alt: string;
};

export type ProductImageDirectiveParseResult =
  | ({ ok: true } & ProductImageReference)
  | {
      ok: false;
      reason: 'not_product_image_directive' | 'missing_file_id' | 'invalid_file_id';
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseProductImageDirective(node: ProductImageDirectiveNode): ProductImageDirectiveParseResult {
  if (node.name !== PRODUCT_IMAGE_DIRECTIVE_NAME) {
    return { ok: false, reason: 'not_product_image_directive' };
  }

  const fileId = node.attributes?.fileId;
  if (typeof fileId !== 'string' || fileId.trim().length === 0) {
    return { ok: false, reason: 'missing_file_id' };
  }

  if (!UUID_RE.test(fileId)) {
    return { ok: false, reason: 'invalid_file_id' };
  }

  const alt = node.attributes?.alt;
  return {
    ok: true,
    fileId,
    alt: typeof alt === 'string' ? alt : '',
  };
}

function escapeDirectiveAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function createProductImageDirective({ fileId, alt }: ProductImageReference): string {
  const escapedAlt = escapeDirectiveAttr(alt);
  return `::${PRODUCT_IMAGE_DIRECTIVE_NAME}{fileId="${fileId}" alt="${escapedAlt}"}`;
}
```

Create `packages/product-description/index.ts`:

```ts
export * from './directive';
```

- [ ] **Step 5: Add root TypeScript/Jest aliases**

Modify `tsconfig.json` under `compilerOptions.paths`:

```json
"@packages/product-description": [
  "packages/product-description"
],
"@packages/product-description/*": [
  "packages/product-description/*"
]
```

Modify `package.json` under `jest.moduleNameMapper`:

```json
"^@packages/product-description(|/.*)$": "<rootDir>/packages/product-description$1"
```

- [ ] **Step 6: Run the package test**

Run:

```bash
yarn jest packages/product-description/directive.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json packages/product-description
git commit -m "[catalog] add product description markdown contract"
```

## Task 2: Admin Dependencies And API Client Surface

**Files:**
- Modify: `apps/admin-web/package.json`
- Modify: `apps/admin-web/tsconfig.json`
- Modify: `apps/admin-web/src/lib/types/dto/products.ts`
- Modify: `apps/admin-web/src/lib/services/products/products-detail.types.ts`
- Modify: `apps/admin-web/src/lib/services/products/use-product-detail.ts`
- Modify: `apps/admin-web/src/lib/api/domains/files/upload.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/versions.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts`

- [ ] **Step 1: Add admin renderer dependencies**

Run from the repository root:

```bash
yarn --cwd apps/admin-web add react-markdown remark-gfm remark-directive
```

Expected: `apps/admin-web/package.json` includes those dependencies. Avoid unrelated lockfile churn.

- [ ] **Step 2: Add the admin TypeScript alias**

Modify `apps/admin-web/tsconfig.json` under `compilerOptions.paths`:

```json
"@packages/product-description": ["../../packages/product-description"],
"@packages/product-description/*": ["../../packages/product-description/*"]
```

Keep the existing `"@/*": ["./src/*"]` alias.

- [ ] **Step 3: Fix product DTO fields**

Modify `apps/admin-web/src/lib/types/dto/products.ts`:

```ts
export interface CreateMasterDto {
  name: string;
  description?: string;
  descriptionHtml?: string;
  basePrice: number;
  pricingStrategy: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
}

export interface UpdateMasterDto {
  name?: string;
  description?: string | null;
  descriptionHtml?: string | null;
  basePrice?: number;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
}
```

- [ ] **Step 4: Add detail and update-version types**

Modify `apps/admin-web/src/lib/services/products/products-detail.types.ts`:

```ts
export type ProductMasterDetail = {
  id: string;
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  brand: string | null;
  status: string | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  optionGroups: ProductOptionGroup[];
  images: ProductImage[];
};
```

In `MasterVersionDetailDto`, add:

```ts
descriptionHtml: string | null;
```

Add this export near `MasterVersionDetailDto`:

```ts
export type UpdateMasterVersionDto = {
  description?: string | null;
  descriptionHtml?: string | null;
};
```

- [ ] **Step 5: Carry `descriptionHtml` through the detail view**

Modify `apps/admin-web/src/lib/services/products/use-product-detail.ts`.

Add to `ProductDetailView`:

```ts
descriptionHtml: string | null;
```

Add to `fromMaster`:

```ts
descriptionHtml: master.descriptionHtml,
```

Add to `fromVersion`:

```ts
descriptionHtml: detail.descriptionHtml,
```

- [ ] **Step 6: Export the product-description image context**

Modify `apps/admin-web/src/lib/api/domains/files/upload.client.ts`:

```ts
import { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID } from '@packages/product-description';

export { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID };
```

Keep the existing `DIGITAL_ASSET_FILE_CONTEXT_ID` export.

- [ ] **Step 7: Add version update client**

Modify `apps/admin-web/src/lib/api/domains/products/versions.client.ts`:

```ts
import type { MasterVersionDetailDto, UpdateMasterVersionDto } from '@/lib/services/products/products-detail.types';
```

Add to `versionsClient`:

```ts
update: async (
  masterId: string,
  versionId: string,
  dto: UpdateMasterVersionDto,
): Promise<MasterVersionDetailDto> =>
  (await client.put(`${base(masterId)}/${versionId}`, dto)).data,
```

- [ ] **Step 8: Add version update mutation**

Modify `apps/admin-web/src/lib/services/products/mutations.ts`:

```ts
import type { UpdateMasterVersionDto } from './products-detail.types';
```

Add after `useCreateMasterDraftVersion`:

```ts
export const useUpdateMasterVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
      dto,
    }: {
      masterId: string;
      versionId: string;
      dto: UpdateMasterVersionDto;
    }) => products.versions.update(masterId, versionId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.versionDetail(variables.masterId, variables.versionId),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(variables.masterId),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masterVersions(variables.masterId),
      });
    },
  });
};
```

- [ ] **Step 9: Run admin typecheck**

Run:

```bash
yarn --cwd apps/admin-web type-check
```

Expected: PASS. If Next cannot resolve `@packages/product-description`, fix `apps/admin-web/tsconfig.json` paths before moving on.

- [ ] **Step 10: Commit**

```bash
git add apps/admin-web/package.json apps/admin-web/tsconfig.json apps/admin-web/src/lib
git commit -m "[admin-web] add product version description client"
```

## Task 3: Admin Markdown Renderer And Image Upload

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/product-description-image.tsx`
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/product-description-markdown.tsx`
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/markdown-image-upload-button.tsx`

- [ ] **Step 1: Create the product image component**

Create `apps/admin-web/src/features/mall/products-detail/components/description/product-description-image.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { FILE_SERVICE_BASE_URL } from '@/const';

type Props = {
  fileId: string | null;
  alt: string;
  error?: string | null;
};

export function ProductDescriptionImage({ fileId, alt, error }: Props) {
  const [broken, setBroken] = useState(false);

  if (!fileId || error || broken) {
    return (
      <div className="my-3 flex min-h-24 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" />
        <span>
          이미지를 불러올 수 없습니다{fileId ? `: ${fileId}` : ''}{alt ? ` (${alt})` : ''}
        </span>
      </div>
    );
  }

  return (
    <img
      src={`${FILE_SERVICE_BASE_URL}/files/public/${fileId}`}
      alt={alt}
      className="my-3 max-w-full rounded-md"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
```

- [ ] **Step 2: Create the Markdown renderer**

Create `apps/admin-web/src/features/mall/products-detail/components/description/product-description-markdown.tsx`:

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import {
  parseProductImageDirective,
  PRODUCT_IMAGE_DIRECTIVE_NAME,
} from '@packages/product-description';
import { ProductDescriptionImage } from './product-description-image';

type MutableNode = {
  type?: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
  children?: MutableNode[];
  url?: string;
  alt?: string;
  data?: { hProperties?: Record<string, unknown> };
};

const PRODUCT_FILE_URL_PREFIX = 'product-file:';

function isDirective(node: MutableNode): boolean {
  return (
    node.type === 'leafDirective' ||
    node.type === 'textDirective' ||
    node.type === 'containerDirective'
  );
}

function remarkProductImageDirective() {
  return (tree: MutableNode) => {
    const walk = (node: MutableNode) => {
      const children = node.children;
      if (!children) return;

      children.forEach((child, index) => {
        if (isDirective(child) && child.name === PRODUCT_IMAGE_DIRECTIVE_NAME) {
          const parsed = parseProductImageDirective(child);
          if (parsed.ok) {
            children[index] = {
              type: 'image',
              url: `${PRODUCT_FILE_URL_PREFIX}${parsed.fileId}`,
              alt: parsed.alt,
              data: {
                hProperties: {
                  'data-product-image-file-id': parsed.fileId,
                },
              },
            };
          } else {
            children[index] = {
              type: 'image',
              url: `${PRODUCT_FILE_URL_PREFIX}invalid`,
              alt: '상품 상세 이미지',
              data: {
                hProperties: {
                  'data-product-image-error': parsed.reason,
                },
              },
            };
          }
          return;
        }

        walk(child);
      });
    };

    walk(tree);
  };
}

type ProductImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  'data-product-image-file-id'?: string;
  'data-product-image-error'?: string;
};

export function ProductDescriptionMarkdown({ value }: { value: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkProductImageDirective]}
        components={{
          img: (props: ProductImageProps) => {
            const src = typeof props.src === 'string' ? props.src : '';
            if (!src.startsWith(PRODUCT_FILE_URL_PREFIX)) {
              return (
                <ProductDescriptionImage
                  fileId={null}
                  alt={props.alt ?? ''}
                  error="raw_url_image_not_supported"
                />
              );
            }

            return (
              <ProductDescriptionImage
                fileId={props['data-product-image-file-id'] ?? null}
                alt={props.alt ?? ''}
                error={props['data-product-image-error'] ?? null}
              />
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Create image upload button**

Create `apps/admin-web/src/features/mall/products-detail/components/description/markdown-image-upload-button.tsx`:

```tsx
'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { createProductImageDirective } from '@packages/product-description';

type Props = {
  disabled?: boolean;
  onInsert: (markdown: string) => void;
};

export function MarkdownImageUploadButton({ disabled, onInsert }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const upload = await uploadFileToFileService(file, {
        contextId: PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
        isPublic: true,
      });
      onInsert(createProductImageDirective({ fileId: upload.id, alt: file.name }));
      toast.success('상세설명 이미지가 업로드되었습니다.', { description: upload.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="h-4 w-4" />
        {uploading ? '업로드 중...' : '이미지'}
      </Button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFileChange} />
    </>
  );
}
```

- [ ] **Step 4: Run admin typecheck**

Run:

```bash
yarn --cwd apps/admin-web type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/description
git commit -m "[admin-web] add product description markdown renderer"
```

## Task 4: Admin Product Description Card

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-detail/template/index.tsx`

- [ ] **Step 1: Create the card component**

Create `apps/admin-web/src/features/mall/products-detail/components/description/index.tsx`:

```tsx
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { ProductDescriptionMarkdown } from './product-description-markdown';
import { MarkdownImageUploadButton } from './markdown-image-upload-button';

type Props = { masterId: string; versionId: string | null };

function insertAtCursor(textarea: HTMLTextAreaElement | null, current: string, insert: string): string {
  if (!textarea) return `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${insert}\n`;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const prefix = current.slice(0, start);
  const suffix = current.slice(end);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith('\n');
  return `${prefix}${needsLeadingNewline ? '\n' : ''}${insert}${needsTrailingNewline ? '\n' : ''}${suffix}`;
}

function LegacyHtmlPreview({ html }: { html: string }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">레거시 HTML 미리보기</div>
      <div
        className="prose prose-sm max-w-none rounded-md border bg-muted/20 p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ProductDetailDescriptionContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const updateVersion = useUpdateMasterVersion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canEdit = data.source === 'version' && data.status === 'draft' && Boolean(data.versionId);
  const [draft, setDraft] = useState(data.description ?? '');

  useEffect(() => {
    setDraft(data.description ?? '');
  }, [data.versionId, data.description]);

  const handleSave = () => {
    if (!data.versionId) return;
    updateVersion.mutate(
      {
        masterId,
        versionId: data.versionId,
        dto: { description: draft.trim().length > 0 ? draft : null },
      },
      {
        onSuccess: () => toast.success('상품 상세설명을 저장했습니다.'),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : '상품 상세설명 저장에 실패했습니다.'),
      },
    );
  };

  const insertMarkdown = (markdown: string) => {
    setDraft((current) => insertAtCursor(textareaRef.current, current, markdown));
    textareaRef.current?.focus();
  };

  const previewValue = canEdit ? draft : data.description ?? '';

  return (
    <div className="flex flex-col gap-4 p-4">
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Markdown</div>
            <div className="flex items-center gap-2">
              <MarkdownImageUploadButton disabled={updateVersion.isPending} onInsert={insertMarkdown} />
              <Button size="sm" disabled={updateVersion.isPending} onClick={handleSave}>
                <Save className="h-4 w-4" />
                {updateVersion.isPending ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            placeholder="Markdown으로 상품 상세설명을 작성하세요."
          />
        </div>
      ) : (
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          상품 상세설명은 draft version에서만 수정할 수 있습니다.
        </div>
      )}

      {previewValue.trim().length > 0 ? (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Markdown 미리보기</div>
          <ProductDescriptionMarkdown value={previewValue} />
        </div>
      ) : (
        <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Markdown 상세설명이 비어 있습니다.
        </div>
      )}

      {!data.description && data.descriptionHtml ? <LegacyHtmlPreview html={data.descriptionHtml} /> : null}
    </div>
  );
}

export function ProductDetailDescription({ masterId, versionId }: Props) {
  return (
    <Container>
      <Header title="상품 상세설명" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailDescriptionContent masterId={masterId} versionId={versionId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
```

- [ ] **Step 2: Add the card to product detail**

Modify `apps/admin-web/src/features/mall/products-detail/template/index.tsx`.

Add import:

```ts
import { ProductDetailDescription } from '../components/description';
```

Render it after `ProductDetailGeneral`:

```tsx
<ProductDetailGeneral masterId={masterId} versionId={versionId} />
<ProductDetailDescription masterId={masterId} versionId={versionId} />
<ProductDetailOptions masterId={masterId} versionId={versionId} />
```

- [ ] **Step 3: Run admin typecheck**

Run:

```bash
yarn --cwd apps/admin-web type-check
```

Expected: PASS.

- [ ] **Step 4: Manual admin verification**

Run admin-web:

```bash
yarn start:admin-web:dev
```

Open a product detail page in three states:

- Active HTML-only product: Markdown area is read-only/empty, legacy HTML preview renders.
- Draft product with Markdown: textarea renders, preview renders heading/list/directive image.
- Draft product with invalid `::product-image{fileId="bad"}`: preview shows a broken image placeholder with diagnostic text.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/products-detail
git commit -m "[admin-web] add product description editor"
```

## Task 5: Channel Adapter Projection Regression

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts`

- [ ] **Step 1: Add a failing regression test**

Add this test inside `describe('transformPimToMedusa')`:

```ts
it('does not project product detail markdown or legacy HTML into Medusa description', () => {
  const result = transformPimToMedusa({
    ...mockSnapshot,
    description: '# Markdown detail\n\n::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="상세"}',
    descriptionHtml: '<img src="https://legacy.example/detail.jpg" />',
  });

  expect(result.description).toBeUndefined();
});
```

- [ ] **Step 2: Run the transformer test**

Run:

```bash
yarn jest apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts --runInBand
```

Expected: PASS if the current `const description = undefined;` contract is intact. If older assertions fail because the fixture expects the previous handle format, update only those stale expectations to the current transformer behavior and keep this new description projection assertion.

- [ ] **Step 3: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts
git commit -m "[channel-adapter] lock medusa description projection"
```

## Task 6: Core Contract Verification

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts`
- Modify if the new test exposes a mapper regression: `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.ts`

- [ ] **Step 1: Verify existing Core behavior**

Confirm these current contracts by reading/running tests before changing code:

- `ProductReadAssembler.getMasterDetail()` returns the active version via `getVersionDetail()`, so raw `ProductDetailDto` already includes `descriptionHtml`.
- `ProductVersionMapper.toDetailResponseDto()` already maps `descriptionHtml`.
- `ProductVersionsService.createDraftVersion()` copies parent version fields through `parentData`, which includes both `description` and `descriptionHtml`.
- `ProductMastersService.updateVersion()` spreads `masterUpdateData`, so draft `description` updates already persist.

- [ ] **Step 2: Run Core build**

Run:

```bash
yarn build:core
```

Expected: PASS.

- [ ] **Step 3: Add mapper regression test**

Create `apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts`:

```ts
import { ProductVersionMapper } from './product-version.mapper';

describe('ProductVersionMapper', () => {
  it('includes both canonical markdown and legacy html descriptions', () => {
    const response = ProductVersionMapper.toDetailResponseDto({
      id: 'version-1',
      masterId: 'master-1',
      version: 2,
      status: 'draft',
      name: '상품',
      description: '# Markdown',
      descriptionHtml: '<img src="legacy.jpg" />',
      brand: null,
      thumbnail: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: null,
      isWholesaleOnly: false,
      isMembershipOnly: false,
      productType: null,
      productCode: null,
      alternativeName: null,
      material: null,
      salesClassification: null,
      purchaseClassification: null,
      shippingMethodId: null,
      marketPrice: null,
      supplyPrice: null,
      supplierId: null,
      ageRestriction: null,
      minQuantity: null,
      maxQuantity: null,
      salesStartDate: null,
      salesEndDate: null,
      parentVersionId: null,
      draftOwnerId: 'user-1',
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      images: [],
      optionGroups: [],
      variants: [],
      channelProducts: [],
    } as any);

    expect(response.description).toBe('# Markdown');
    expect(response.descriptionHtml).toBe('<img src="legacy.jpg" />');
  });
});
```

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/mappers/product-version.mapper.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/catalog/core/products
git commit -m "[catalog] verify product description version contract"
```

## Task 7: Final Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run focused tests**

Run:

```bash
yarn jest packages/product-description/directive.spec.ts --runInBand
yarn jest apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run builds/typechecks**

Run:

```bash
yarn build:core
yarn build:channel-adapter
yarn --cwd apps/admin-web type-check
```

Expected: PASS.

- [ ] **Step 3: Run admin build**

Run:

```bash
yarn build:admin-web
```

Expected: PASS. If this fails because external package imports are not transpiled by Next, add the package to `apps/admin-web/next.config.*` `transpilePackages` or move the React-facing adapter into `apps/admin-web/src` while keeping only the directive contract in `packages/product-description`.

- [ ] **Step 4: Manual smoke test**

Use a draft product version and save:

```md
# 사용 방법

- 첫 번째 단계
- 두 번째 단계

::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="상품 상세 이미지"}
```

Verify:

- Admin preview renders heading/list/image placeholder or image.
- Saving updates only the draft version.
- Active product view does not change until publish.
- Existing HTML-only product still shows legacy HTML preview.
- Medusa transformed payload still has `description: undefined`.

- [ ] **Step 5: Final commit**

If verification required fixes:

```bash
git add .
git commit -m "[catalog] finish product description markdown support"
```

If no fixes were needed, do not create an empty commit.

## Out Of Scope

- Storefront implementation outside this repository.
- HTML-to-Markdown migration for existing 10k products.
- Sanitizing legacy `descriptionHtml`.
- WYSIWYG Markdown editing.
- AI-generated summary projection into Medusa `description`.

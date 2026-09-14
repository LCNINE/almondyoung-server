'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type {
  ProductAiDraft,
  ProductAiSavedProduct,
} from '@packages/product-ai/draft';
import { productAiClient } from '@/lib/api/domains/products/product-ai.client';
import { buildDraftEditPath } from '@/features/mall/my-drafts/lib/draft-edit-path';
import { Button } from '@/components/ui/button';

export function ProductAiDraftPreview({
  draft,
  sessionId,
  messageId,
  savedProduct,
  canSave,
  onSaved,
}: {
  draft: ProductAiDraft;
  sessionId: string;
  messageId: string;
  savedProduct: ProductAiSavedProduct | null;
  canSave: boolean;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProductAiSavedProduct | null>(null);
  const result =
    saved ?? (savedProduct?.messageId === messageId ? savedProduct : null);
  async function save() {
    if (saving || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      setSaved(await productAiClient.saveDraft(sessionId, messageId));
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '상품 초안을 저장하지 못했습니다. 다시 시도해 주세요.'
      );
    } finally {
      setSaving(false);
    }
  }
  const thumbnail = (id: string, alt: string, className: string) => (
    // Private previews use the authenticated file route, not a public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/proxy/file/files/${id}/open`}
      alt={alt}
      className={className}
      loading="lazy"
    />
  );
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-indigo-100 bg-white text-slate-800">
      <div className="border-b border-indigo-50 bg-indigo-50/50 px-4 py-3">
        <p className="text-xs font-medium text-indigo-600">
          상품 초안 미리보기
        </p>
        <p className="mt-1 font-semibold">{draft.name}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
          {draft.description}
        </p>
      </div>
      <div className="space-y-3 p-4">
        {(draft.thumbnailFileId || draft.additionalImageFileIds.length > 0) && (
          <div className="flex flex-wrap gap-3">
            {draft.thumbnailFileId && (
              <div className="text-center text-xs text-slate-500">
                {thumbnail(
                  draft.thumbnailFileId,
                  '대표 이미지',
                  'mb-1 h-16 w-16 rounded-md border object-cover'
                )}
                대표
              </div>
            )}
            {draft.additionalImageFileIds.map((id, index) => (
              <div
                key={`${id}-${index}`}
                className="text-center text-xs text-slate-500"
              >
                {thumbnail(
                  id,
                  `부가 이미지 ${index + 1}`,
                  'mb-1 h-16 w-16 rounded-md border object-cover'
                )}
                부가 {index + 1}
              </div>
            ))}
          </div>
        )}
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            상세페이지
          </summary>
          <div className="mt-2 max-h-80 space-y-4 overflow-y-auto rounded-lg border bg-white p-3">
            {draft.sections.map((section, index) =>
              section.kind === 'image' ? (
                <figure key={index}>
                  {thumbnail(
                    section.fileId,
                    section.alt,
                    'h-auto max-w-full rounded-md'
                  )}
                </figure>
              ) : (
                <section key={index}>
                  {section.heading && (
                    <h3 className="mb-1 font-semibold">{section.heading}</h3>
                  )}
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {section.body}
                  </p>
                </section>
              )
            )}
          </div>
        </details>
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            SEO · 태그
          </summary>
          <dl className="mt-2 space-y-2 text-xs">
            <div>
              <dt className="text-slate-500">SEO 제목</dt>
              <dd>{draft.seoTitle}</dd>
            </div>
            <div>
              <dt className="text-slate-500">SEO 설명</dt>
              <dd>{draft.seoDescription}</dd>
            </div>
            <div>
              <dt className="text-slate-500">SEO 키워드</dt>
              <dd>{draft.seoKeywords.join(', ') || '없음'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">운영 태그 제안 (별도 설정)</dt>
              <dd>{draft.tags.join(', ') || '없음'}</dd>
            </div>
          </dl>
        </details>
        {draft.pendingItems.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-medium">추가로 확인할 내용</p>
            <ul className="mt-1 list-inside list-disc">
              {draft.pendingItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-500">
          상품명·설명·이미지·SEO를 초안에 저장합니다.
          가격·옵션·재고·카테고리·운영 태그는 상품 편집 화면에서 설정해 주세요.
        </p>
        {result ? (
          <Link
            className="inline-block text-sm font-medium text-indigo-600 underline"
            href={buildDraftEditPath(result.masterId, result.versionId)}
          >
            저장된 상품 초안 열기 ↗
          </Link>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              저장하면 사용한 이미지를 상품용 공개 파일로 복사합니다. 상품은
              발행되지 않습니다.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={saving || !canSave}
              onClick={() => void save()}
            >
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {saving
                ? '상품 초안 저장 중…'
                : savedProduct
                  ? '상품 초안에 반영'
                  : '상품 초안으로 저장'}
            </Button>
            {!canSave && (
              <p className="text-xs text-slate-500">
                최신 대화 내용으로 미리보기를 다시 요청해 주세요.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

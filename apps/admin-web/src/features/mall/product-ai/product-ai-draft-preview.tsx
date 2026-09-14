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
import { publicationNextStep } from '@packages/product-ai/publication';

export function ProductAiDraftPreview({
  draft,
  sessionId,
  messageId,
  savedProduct,
  canSave,
  onSaved,
  publicationRequested,
  onContinue,
  currentDraft,
  canContinue,
}: {
  draft: ProductAiDraft;
  sessionId: string;
  messageId: string;
  savedProduct: ProductAiSavedProduct | null;
  canSave: boolean;
  onSaved: () => Promise<void>;
  publicationRequested: boolean;
  onContinue: (prompt: string) => void;
  currentDraft: boolean;
  canContinue: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProductAiSavedProduct | null>(null);
  const result =
    saved ?? (savedProduct?.messageId === messageId ? savedProduct : null);
  const awaitingPublication =
    publicationRequested && savedProduct?.status !== 'active';
  const nextStep = awaitingPublication ? publicationNextStep(draft) : null;
  async function save() {
    if (saving || !canSave || awaitingPublication) return;
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
          {result?.status === 'active'
            ? '등록·발행 완료'
            : awaitingPublication && currentDraft
              ? '발행 전 확인이 필요해요'
              : '상품 미리보기'}
        </p>
        <p className="mt-1 font-semibold">{draft.name}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
          {draft.description}
        </p>
      </div>
      <div className="space-y-3 p-4">
        {awaitingPublication && currentDraft && (
          <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              등록 요청을 받았어요 · 아직 발행되지 않았어요
            </p>
            <p>
              {nextStep?.question ?? '대화에서 다음 등록 단계를 확인해 주세요.'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!canContinue}
              onClick={() =>
                onContinue(
                  nextStep?.prompt ??
                    '현재 상품의 발행을 막는 항목과 다음 단계를 알려줘.'
                )
              }
            >
              {nextStep?.label ?? '다음 등록 단계 확인'}
            </Button>
          </div>
        )}
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
        {draft.sales && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs">
            <dl className="grid grid-cols-2 gap-3">
              {Object.entries({
                판매가: draft.sales.salePrice,
                멤버십가:
                  draft.sales.membershipPricing === 'same'
                    ? draft.sales.salePrice
                    : draft.sales.membershipPrice,
                시장가: draft.sales.marketPrice,
                공급가: draft.sales.supplyPrice,
              }).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-1 font-semibold">
                    {value == null ? '미정' : `${value.toLocaleString()}원`}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3">
              옵션:{' '}
              {draft.sales.options === null
                ? '미정'
                : draft.sales.options.length
                  ? draft.sales.options
                      .map(
                        (group) => `${group.name}: ${group.values.join(', ')}`
                      )
                      .join(' / ')
                  : '없음'}
            </p>
            <p className="mt-2">
              카테고리:{' '}
              {draft.sales.categories
                .map(
                  (category, index) =>
                    `${category.name}${category.id ? '' : ' (새로 생성)'}${index === draft.sales?.primaryCategoryIndex ? ' · 대표' : ''}`
                )
                .join(', ') || '미정'}
            </p>
            <p className="mt-2">
              재고 연결{draft.sales.inventory.length ? '' : ': 미정'}
            </p>
            {draft.sales.inventory.map((item, index) => (
              <p key={index} className="mt-1 text-slate-600">
                {item.optionValues.join(' / ') || '기본 상품'} →{' '}
                {item.newSkuName
                  ? `${item.newSkuName} (새 품목 생성 · 입고 수량 0)`
                  : item.skuId}{' '}
                · 구성 {item.quantity}개
                {item.salePrice
                  ? ` · 판매가 ${item.salePrice.toLocaleString()}원`
                  : ''}
                {item.membershipPrice
                  ? ` · 멤버십가 ${item.membershipPrice.toLocaleString()}원`
                  : ''}
              </p>
            ))}
          </div>
        )}
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            상세페이지
          </summary>
          <div className="mt-3 max-h-[32rem] space-y-8 overflow-y-auto rounded-xl border bg-white px-5 py-7">
            {draft.sections.map((section, index) =>
              section.kind === 'image' ? (
                <figure key={index}>
                  {thumbnail(
                    section.fileId,
                    section.alt,
                    'mx-auto h-auto max-w-full rounded-lg'
                  )}
                </figure>
              ) : (
                <section key={index}>
                  {section.heading && (
                    <h3 className="mb-3 text-base font-semibold">
                      {section.heading}
                    </h3>
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
              <dt className="text-slate-500">운영 태그</dt>
              <dd>
                {draft.tags.join(', ') || '없음'}
                {draft.sales?.tagValueIds.length
                  ? ` · ${draft.sales.tagValueIds.length}개 연결`
                  : ' (제안)'}
              </dd>
            </div>
          </dl>
        </details>
        {!awaitingPublication && draft.pendingItems.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-medium">추가로 확인할 내용</p>
            <ul className="mt-1 list-inside list-disc">
              {draft.pendingItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {awaitingPublication ? (
          !currentDraft && (
            <p className="text-xs text-slate-500">
              이전 미리보기입니다. 최신 답변에서 등록 절차를 이어가 주세요.
            </p>
          )
        ) : result ? (
          <Link
            className="inline-block text-sm font-medium text-indigo-600 underline"
            href={buildDraftEditPath(result.masterId, result.versionId)}
          >
            {result.status === 'active'
              ? '발행한 상품 열기 ↗'
              : '저장된 상품 초안 열기 ↗'}
          </Link>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              상품명·설명·이미지·SEO와 입력한 가격·옵션·카테고리·재고 연결을
              초안에 저장합니다.
            </p>
            <p className="text-xs text-slate-500">
              저장하면 사용한 이미지를 상품용 공개 파일로 복사합니다. 상품은
              초안으로 저장됩니다. 발행하려면 채팅에 “등록해줘”라고 입력하세요.
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

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
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import { MarkdownImageUploadButton } from './markdown-image-upload-button';
import { ProductDescriptionMarkdown } from './product-description-markdown';

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
                <Save data-icon="inline-start" />
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

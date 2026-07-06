'use client';

import { RefObject, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useInViewport } from '@/lib/hooks/use-in-viewport';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import { MarkdownImageUploadButton } from './markdown-image-upload-button';
import { ProductDescriptionMarkdown } from './product-description-markdown';
import { shouldShowFloatingCollapse } from './product-description-floating-collapse';

type Props = { masterId: string; versionId: string | null };

type ContentProps = Props & {
  /** 접기 시 스크롤을 되돌릴 섹션 카드 ref */
  sectionRef: RefObject<HTMLDivElement | null>;
};

function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  current: string,
  insert: string
): string {
  if (!textarea)
    return `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${insert}\n`;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const prefix = current.slice(0, start);
  const suffix = current.slice(end);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith('\n');
  return `${prefix}${needsLeadingNewline ? '\n' : ''}${insert}${needsTrailingNewline ? '\n' : ''}${suffix}`;
}

function LegacyHtmlPreview({
  html,
  canClear,
  onClear,
  pending,
}: {
  html: string;
  canClear: boolean;
  onClear: () => void;
  pending: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-medium text-muted-foreground">
          레거시 HTML 미리보기
        </div>
        {canClear ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={onClear}
          >
            <Trash2 data-icon="inline-start" />
            {pending ? '삭제 중...' : '레거시 HTML 비우기'}
          </Button>
        ) : null}
      </div>
      <div
        className="p-3 prose-sm prose border rounded-md max-w-none bg-muted/20"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ProductDetailDescriptionContent({
  masterId,
  versionId,
  sectionRef,
}: ContentProps) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const updateVersion = useUpdateMasterVersion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const canEdit =
    data.source === 'version' &&
    data.status === 'draft' &&
    Boolean(data.versionId);
  const [draft, setDraft] = useState(data.description ?? '');
  const hasContent =
    (data.description ?? '').trim().length > 0 || Boolean(data.descriptionHtml);
  const [open, setOpen] = useState(!hasContent);

  // 펼쳐진 본문은 화면에 있는데 하단 실제 접기 버튼은 화면 밖일 때만 floating 버튼을 띄운다.
  const contentVisible = useInViewport(contentRef, { enabled: open });
  const triggerFullyVisible = useInViewport(triggerRef, { threshold: 1 });
  const showFloatingCollapse = shouldShowFloatingCollapse({
    open,
    contentVisible,
    triggerFullyVisible,
  });

  // createPortal 은 클라이언트에서만 — SSR 가드
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setDraft(data.description ?? '');
  }, [data.versionId, data.description]);

  const handleFloatingCollapse = () => {
    setOpen(false);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
          toast.error(
            err instanceof Error
              ? err.message
              : '상품 상세설명 저장에 실패했습니다.'
          ),
      }
    );
  };

  const handleClearLegacy = () => {
    if (!data.versionId) return;
    updateVersion.mutate(
      {
        masterId,
        versionId: data.versionId,
        dto: { descriptionHtml: null },
      },
      {
        onSuccess: () => toast.success('레거시 HTML을 비웠습니다.'),
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : '레거시 HTML 삭제에 실패했습니다.'
          ),
      }
    );
  };

  const insertMarkdown = (markdown: string) => {
    setDraft((current) =>
      insertAtCursor(textareaRef.current, current, markdown)
    );
    textareaRef.current?.focus();
  };

  const previewValue = canEdit ? draft : (data.description ?? '');

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="p-4">
      <CollapsibleContent
        ref={contentRef}
        className="flex flex-col gap-4 data-[state=closed]:hidden"
      >
        {canEdit ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Markdown</div>
              <div className="flex items-center gap-2">
                <MarkdownImageUploadButton
                  disabled={updateVersion.isPending}
                  onInsert={insertMarkdown}
                />
                <Button
                  size="sm"
                  disabled={updateVersion.isPending}
                  onClick={handleSave}
                >
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
          <div className="px-3 py-2 text-sm border rounded-md bg-muted/20 text-muted-foreground">
            상품 상세설명은 draft version에서만 수정할 수 있습니다.
          </div>
        )}

        {previewValue.trim().length > 0 ? (
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Markdown 미리보기
            </div>
            <ProductDescriptionMarkdown value={previewValue} />
          </div>
        ) : (
          <div className="px-3 py-6 text-sm text-center border border-dashed rounded-md text-muted-foreground">
            Markdown 상세설명이 비어 있습니다.
          </div>
        )}

        {!data.description && data.descriptionHtml ? (
          <LegacyHtmlPreview
            html={data.descriptionHtml}
            canClear={canEdit}
            onClear={handleClearLegacy}
            pending={updateVersion.isPending}
          />
        ) : null}
      </CollapsibleContent>

      {!open && hasContent ? (
        // 상품 상세 설명 접힌 상태 미리보기
        <div className="relative overflow-hidden max-h-48">
          {previewValue.trim().length > 0 ? (
            <ProductDescriptionMarkdown value={previewValue} />
          ) : data.descriptionHtml ? (
            <div
              className="prose-sm prose max-w-none"
              dangerouslySetInnerHTML={{ __html: data.descriptionHtml }}
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 h-16 pointer-events-none bg-gradient-to-t from-background to-transparent" />
        </div>
      ) : null}

      <div ref={triggerRef} className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="justify-center w-full gap-1">
            {open ? '상품설명 접기' : '상품설명 더보기'}
            <ChevronDown
              className="transition-transform duration-200 size-4"
              style={{ transform: open ? 'rotate(180deg)' : undefined }}
            />
          </Button>
        </CollapsibleTrigger>
      </div>

      {mounted && showFloatingCollapse
        ? createPortal(
            <div className="fixed z-40 -translate-x-1/2 duration-200 bottom-6 left-1/2 animate-in fade-in slide-in-from-bottom-4">
              <Button
                variant="outline"
                onClick={handleFloatingCollapse}
                className="gap-1 shadow-lg"
              >
                <ChevronUp className="size-4" />
                상품설명 접기
              </Button>
            </div>,
            document.body
          )
        : null}
    </Collapsible>
  );
}

export function ProductDetailDescription({ masterId, versionId }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  return (
    <Container ref={sectionRef} className="scroll-mt-4">
      <Header title="상품 상세설명" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailDescriptionContent
            masterId={masterId}
            versionId={versionId}
            sectionRef={sectionRef}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}

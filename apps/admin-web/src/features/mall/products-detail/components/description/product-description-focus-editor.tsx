'use client';

import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownImageUploadButton } from './markdown-image-upload-button';
import { ProductDescriptionMarkdown } from './product-description-markdown';
import { insertAtCursor } from './product-description-insert';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: string;
  onSave: (value: string) => void;
  pending: boolean;
};

export function ProductDescriptionFocusEditor({
  open,
  onOpenChange,
  initialValue,
  onSave,
  pending,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialValue);

  // 저장 후에도 오버레이는 열려 있으므로, 저장된 값으로의 재-seed 는 '열릴 때'에만 한다.
  useEffect(() => {
    if (open) setDraft(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const insertMarkdown = (markdown: string) => {
    const el = textareaRef.current;
    setDraft((current) => {
      const selection = el
        ? {
            start: el.selectionStart ?? current.length,
            end: el.selectionEnd ?? current.length,
          }
        : undefined;
      return insertAtCursor(current, markdown, selection);
    });
    textareaRef.current?.focus();
  };

  const handleOpenChange = (next: boolean) => {
    // dirty 판정은 저장 매핑(공백만 → null → '')과 동일하게 정규화해서 비교한다.
    // 그래야 공백만 입력 후 저장한 직후 닫을 때 false "미저장" 경고가 뜨지 않는다.
    const normalizedDraft = draft.trim().length > 0 ? draft : '';
    if (!next && normalizedDraft !== initialValue) {
      const confirmed = window.confirm(
        '저장하지 않은 변경이 있습니다. 편집을 닫을까요?'
      );
      if (!confirmed) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[1400px]"
      >
        {/* pr-14: 우상단 기본 닫기(X) 버튼과 저장 버튼이 겹치지 않도록 여백 확보 */}
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3 pr-14 text-left">
          <DialogTitle>상품 상세설명 편집</DialogTitle>
          <Button size="sm" disabled={pending} onClick={() => onSave(draft)}>
            <Save data-icon="inline-start" />
            {pending ? '저장 중...' : '저장'}
          </Button>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          {/* 에디터: 좁을 땐 위(order-1), 넓을 땐 오른쪽(order-2) */}
          <div className="order-1 flex min-h-0 flex-col gap-2 lg:order-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Markdown</span>
              <MarkdownImageUploadButton
                disabled={pending}
                onInsert={insertMarkdown}
              />
            </div>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Markdown으로 상품 상세설명을 작성하세요."
              className="min-h-0 flex-1 resize-none font-mono text-sm"
            />
          </div>

          {/* 미리보기: 좁을 땐 아래(order-2), 넓을 땐 왼쪽(order-1) */}
          <div className="order-2 min-h-0 overflow-y-auto rounded-md border bg-muted/20 p-4 lg:order-1">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              미리보기
            </div>
            {draft.trim().length > 0 ? (
              <ProductDescriptionMarkdown value={draft} />
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                작성한 내용이 여기에 표시됩니다.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

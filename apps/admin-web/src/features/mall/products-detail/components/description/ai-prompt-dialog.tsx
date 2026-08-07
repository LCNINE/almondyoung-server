'use client';

import { useEffect, useState } from 'react';
import { Copy, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  aiPromptsClient,
  type AiPromptPresetDto,
} from '@/lib/api/domains/products/ai-prompts.client';
import { BUILTIN_PRESET_VALUE } from './ai-prompt-select';
import {
  DEFAULT_PRODUCT_DESCRIPTION_PROMPT,
  IMAGE_DIRECTIVE_RULES,
} from './product-description-prompt';

type Props = {
  presets: AiPromptPresetDto[];
  selectedId: string;
  disabled?: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
};

/** 목록에서 '새로 만드는 중' 상태를 가리키는 가짜 ID. */
const NEW_PRESET_ID = '__new__';

export function AiPromptDialog({
  presets,
  selectedId,
  disabled,
  onRefresh,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>(BUILTIN_PRESET_VALUE);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(DEFAULT_PRODUCT_DESCRIPTION_PROMPT);
  const [saving, setSaving] = useState(false);

  const isBuiltin = editingId === BUILTIN_PRESET_VALUE;
  const isNew = editingId === NEW_PRESET_ID;
  const editing = presets.find((preset) => preset.id === editingId) ?? null;
  const canEdit = isNew || editing?.isMine === true;

  // 열 때 현재 고른 양식을 편집 대상으로 잡는다.
  useEffect(() => {
    if (!open) return;

    const current = presets.find((preset) => preset.id === selectedId);
    if (current) {
      setEditingId(current.id);
      setTitle(current.title);
      setContent(current.content);
    } else {
      setEditingId(BUILTIN_PRESET_VALUE);
      setTitle('기본 양식');
      setContent(DEFAULT_PRODUCT_DESCRIPTION_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 저장하지 않은 편집분이 남아 있는가. 목록을 옮길 때 조용히 날리지 않기 위한 판정. */
  const isDirty = () => {
    if (isBuiltin) return false;
    if (isNew) {
      return (
        title.trim().length > 0 ||
        content !== DEFAULT_PRODUCT_DESCRIPTION_PROMPT
      );
    }
    if (!editing || !editing.isMine) return false;
    return title !== editing.title || content !== editing.content;
  };

  /** 편집 중이던 내용이 있으면 물어보고 넘어간다. */
  const guarded = (move: () => void) => {
    if (isDirty()) {
      const message = isNew
        ? '작성 중인 새 양식이 사라집니다. 그만둘까요?'
        : '저장하지 않은 변경이 있습니다. 버릴까요?';
      if (!window.confirm(message)) return;
    }
    move();
  };

  const pickBuiltin = () => {
    setEditingId(BUILTIN_PRESET_VALUE);
    setTitle('기본 양식');
    setContent(DEFAULT_PRODUCT_DESCRIPTION_PROMPT);
  };

  const pick = (preset: AiPromptPresetDto) => {
    setEditingId(preset.id);
    setTitle(preset.title);
    setContent(preset.content);
  };

  const startNew = (seedContent: string, seedTitle: string) => {
    setEditingId(NEW_PRESET_ID);
    setTitle(seedTitle);
    setContent(seedContent);
  };

  const handleSave = async () => {
    if (title.trim().length === 0) {
      toast.error('양식 이름을 입력해주세요.');
      return;
    }
    if (content.trim().length === 0) {
      toast.error('프롬프트를 비워둘 수 없습니다.');
      return;
    }

    setSaving(true);
    try {
      const saved = isNew
        ? await aiPromptsClient.create(title, content)
        : await aiPromptsClient.update(editingId, title, content);

      onRefresh();
      setEditingId(saved.id);
      onSelect(saved.id);
      toast.success(
        isNew ? '새 양식을 추가했습니다.' : '양식을 저장했습니다.',
        {
          description: '다른 어드민도 이 양식을 골라 쓸 수 있습니다.',
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm(`'${editing.title}' 양식을 삭제할까요?`)) return;

    setSaving(true);
    try {
      await aiPromptsClient.remove(editing.id);
      onRefresh();
      if (selectedId === editing.id) onSelect(BUILTIN_PRESET_VALUE);
      pickBuiltin();
      toast.success('양식을 삭제했습니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const rowClass = (active: boolean) =>
    `w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
      active
        ? 'border-primary bg-primary/5 font-medium text-primary'
        : 'hover:bg-muted'
    }`;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Settings2 data-icon="inline-start" />
        양식 관리
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88vh] w-[94vw] max-w-[94vw] flex-col gap-0 p-0 sm:max-w-[1200px]">
          <DialogHeader className="px-4 py-3 text-left border-b pr-14">
            <DialogTitle>AI 프롬프트 양식 설정</DialogTitle>
            <DialogDescription>
              저장한 양식은 어드민 전체가 골라 쓸 수 있습니다. 수정·삭제는 만든
              사람만 가능합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[280px_1fr]">
            {/* 왼쪽: 양식 목록 */}
            <div className="flex flex-col min-h-0 gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">양식 목록</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    guarded(() =>
                      startNew(DEFAULT_PRODUCT_DESCRIPTION_PROMPT, '')
                    )
                  }
                >
                  <Plus data-icon="inline-start" />
                  추가
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {/* 기본 양식은 항상 맨 위 · 삭제 불가 */}
                <button
                  type="button"
                  onClick={() => guarded(pickBuiltin)}
                  className={rowClass(isBuiltin)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">기본 양식</span>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                      기본
                    </span>
                  </div>
                </button>

                {isNew ? (
                  <button
                    type="button"
                    className={rowClass(true)}
                    onClick={() => undefined}
                  >
                    <div className="truncate">
                      {title.trim().length > 0 ? title : '새 양식'}
                    </div>
                    <div className="text-xs text-muted-foreground">저장 전</div>
                  </button>
                ) : null}

                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => guarded(() => pick(preset))}
                    className={rowClass(preset.id === editingId)}
                  >
                    <div className="truncate">{preset.title}</div>
                    <div className="text-xs font-normal truncate text-muted-foreground">
                      {preset.ownerName ?? '작성자 미상'}
                      {preset.isMine ? ' · 내 양식' : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 오른쪽: 편집 */}
            <div className="flex flex-col min-h-0 gap-3">
              {isBuiltin ? (
                <div className="px-3 py-2 text-sm border rounded-md border-destructive/40 bg-destructive/5 text-destructive">
                  기본 양식은 변경할 수 없습니다. 고쳐 쓰려면 아래{' '}
                  <b>복사해서 새 양식으로</b> 를 누르세요.
                </div>
              ) : !canEdit ? (
                <div className="px-3 py-2 text-sm border rounded-md border-destructive/40 bg-destructive/5 text-destructive">
                  다른 어드민이 만든 양식이라 수정·삭제할 수 없습니다. 그대로
                  골라 쓸 수는 있고, 고치려면 <b>복사해서 새 양식으로</b> 를
                  누르세요.
                </div>
              ) : null}

              <Input
                value={title}
                disabled={saving || isBuiltin || !canEdit}
                placeholder="양식 이름 (예: 색소 상품용)"
                onChange={(event) => setTitle(event.target.value)}
              />

              <Textarea
                value={content}
                disabled={saving || isBuiltin || !canEdit}
                onChange={(event) => setContent(event.target.value)}
                className="flex-1 min-h-0 font-mono text-sm resize-none"
              />

              <div className="p-3 border rounded-md bg-muted/20">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  아래 규칙은 어떤 양식을 쓰든 항상 자동으로 덧붙습니다 (편집
                  불가)
                </div>
                <pre className="overflow-auto text-xs whitespace-pre-wrap max-h-20 text-muted-foreground">
                  {IMAGE_DIRECTIVE_RULES}
                </pre>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving || isNew}
                onClick={() =>
                  startNew(
                    content,
                    title.trim().length > 0 ? `${title} 복사본` : ''
                  )
                }
              >
                <Copy data-icon="inline-start" />
                복사해서 새 양식으로
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={saving || isBuiltin || (!isNew && !canEdit)}
                onClick={isNew ? () => guarded(pickBuiltin) : handleDelete}
              >
                <Trash2 data-icon="inline-start" />
                {isNew ? '작성 취소' : '삭제'}
              </Button>
            </div>
            <Button
              size="sm"
              disabled={saving || isBuiltin || !canEdit}
              onClick={handleSave}
            >
              <Save data-icon="inline-start" />
              {saving ? '저장 중...' : isNew ? '추가' : '저장'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateCategory,
  useUpdateCategory,
} from '@/lib/services/products/mutations';
import { toast } from 'sonner';
import { useCategoryDetail } from '../../hooks/use-category-detail';
import type { SelectionMode } from '../../hooks/use-category-selection';

interface Props {
  mode: SelectionMode;
  onAfterCreate: (newId: string) => void;
  onAfterDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: (id: string) => void;
}

interface FormState {
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  slug: '',
  description: '',
  sortOrder: 0,
  isActive: true,
};

export function CategoryDetailPanel({
  mode,
  onAfterCreate,
  onDirtyChange,
  onRequestDelete,
}: Props) {
  if (mode.kind === 'none') return <EmptyState />;
  if (mode.kind === 'create') {
    return (
      <CreateForm
        parentId={mode.parentId}
        onAfterCreate={onAfterCreate}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  return (
    <EditForm
      key={mode.id}
      categoryId={mode.id}
      onDirtyChange={onDirtyChange}
      onRequestDelete={onRequestDelete}
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <p>좌측에서 카테고리를 선택하거나</p>
      <p>새 카테고리를 추가하세요.</p>
    </div>
  );
}

function CreateForm({
  parentId,
  onAfterCreate,
  onDirtyChange,
}: {
  parentId: string | null;
  onAfterCreate: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const create = useCreateCategory();
  const dirty = form.name.trim().length > 0 || form.description.length > 0 || form.slug.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('이름을 입력하세요.');
      return;
    }
    try {
      const created = await create.mutateAsync({
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || undefined,
        parentId,
        sortOrder: form.sortOrder,
      });
      toast.success('카테고리가 생성되었습니다.');
      onDirtyChange(false);
      onAfterCreate(created.id);
    } catch (e) {
      toast.error(extractMessage(e) ?? '생성에 실패했습니다.');
    }
  };

  return (
    <FormShell
      title={parentId ? '새 자식 카테고리' : '새 최상위 카테고리'}
      footer={
        <Button onClick={() => void submit()} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          생성
        </Button>
      }
    >
      <FormFields value={form} onChange={setForm} disableActiveToggle />
    </FormShell>
  );
}

function EditForm({
  categoryId,
  onDirtyChange,
  onRequestDelete,
}: {
  categoryId: string;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: (id: string) => void;
}) {
  const detail = useCategoryDetail(categoryId);
  const update = useUpdateCategory();

  const initial = useMemo<FormState>(
    () =>
      detail.data
        ? {
            name: detail.data.name ?? '',
            slug: detail.data.slug ?? '',
            description: detail.data.description ?? '',
            sortOrder: detail.data.sortOrder ?? 0,
            isActive: detail.data.isActive,
          }
        : EMPTY,
    [detail.data],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  useEffect(() => setForm(initial), [initial]);

  const dirty = useMemo(
    () =>
      form.name !== initial.name ||
      form.slug !== initial.slug ||
      form.description !== initial.description ||
      form.sortOrder !== initial.sortOrder ||
      form.isActive !== initial.isActive,
    [form, initial],
  );

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('이름은 비울 수 없습니다.');
      return;
    }
    try {
      await update.mutateAsync({
        id: categoryId,
        data: {
          name: form.name.trim(),
          slug: form.slug.trim() || undefined,
          description: form.description.trim() || undefined,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        },
      });
      toast.success('저장되었습니다.');
      onDirtyChange(false);
    } catch (e) {
      toast.error(extractMessage(e) ?? '저장에 실패했습니다.');
    }
  };

  if (detail.isLoading || !detail.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 불러오는 중
      </div>
    );
  }

  const directCount = detail.data.productCount;
  const totalCount = detail.data.totalProductCount;

  return (
    <FormShell
      title={initial.name || '카테고리'}
      footer={
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onRequestDelete(categoryId)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            삭제
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm(initial)}
              disabled={!dirty || update.isPending}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!dirty || update.isPending}
            >
              {update.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              저장
            </Button>
          </div>
        </div>
      }
    >
      <FormFields value={form} onChange={setForm} />

      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">이 카테고리에 매핑된 상품</span>
          <span className="font-medium">{directCount}개</span>
        </div>
        {totalCount !== directCount && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>하위 포함</span>
            <span>{totalCount}개</span>
          </div>
        )}
        <Link
          href={`/mall/products-list?categoryId=${categoryId}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          상품 목록 보러가기
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </FormShell>
  );
}

function FormShell({
  title,
  footer,
  children,
}: {
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="truncate text-sm font-medium">{title}</h2>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">{children}</div>
      <div className="border-t p-3">{footer}</div>
    </div>
  );
}

function FormFields({
  value,
  onChange,
  disableActiveToggle,
}: {
  value: FormState;
  onChange: (next: FormState) => void;
  disableActiveToggle?: boolean;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cat-name">이름</Label>
        <Input
          id="cat-name"
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="예: 식품 / 채소 / 감자"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cat-slug">슬러그</Label>
        <Input
          id="cat-slug"
          value={value.slug}
          onChange={(e) => set('slug', e.target.value)}
          placeholder="URL 에 쓰는 식별자 (선택)"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cat-desc">설명</Label>
        <Textarea
          id="cat-desc"
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          placeholder="관리용 메모 또는 노출용 설명 (선택)"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cat-sort">정렬 순서</Label>
        <Input
          id="cat-sort"
          type="number"
          value={value.sortOrder}
          onChange={(e) => set('sortOrder', Number(e.target.value) || 0)}
        />
        <p className="text-xs text-muted-foreground">
          동일 부모 내 정렬은 좌측 트리에서 드래그로 변경할 수 있습니다.
        </p>
      </div>

      {!disableActiveToggle && (
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="cat-active" className="text-sm">
              고객 노출
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              끄면 트리에는 남지만 고객 메뉴에서 숨겨집니다.
            </p>
          </div>
          <Switch
            id="cat-active"
            checked={value.isActive}
            onCheckedChange={(v) => set('isActive', v)}
          />
        </div>
      )}
    </div>
  );
}

function extractMessage(e: unknown): string | undefined {
  if (typeof e === 'object' && e && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return undefined;
}

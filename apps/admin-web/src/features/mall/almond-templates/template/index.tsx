'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/common/pagination';
import { almondTemplatesClient } from '@/lib/api/domains/products/almond-templates.client';
import {
  useAlmondTemplates,
  useDeleteAlmondTemplate,
  useUpdateAlmondTemplateStatus,
} from '@/lib/services/products';
import type { AdminAlmondTemplateDto } from '@/lib/types/dto/products';
import { formatDateTime } from '@/lib/utils/date';
import {
  ALMOND_TEMPLATE_STATUS_LABELS,
  ALMOND_TEMPLATE_STATUS_TABS,
  KIND_FILTER_ALL,
  almondTemplateEditorUrl,
  almondTemplateKindLabel,
  countByTab,
  filterAlmondTemplates,
  kindFilterOptions,
  type AlmondTemplateTab,
} from '../lib/almond-template-rules';

const PER_PAGE = 20;
const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
const DEFAULT_COUNTRY =
  process.env.NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY ?? 'kr';

function isAlmondTemplateTab(value: string): value is AlmondTemplateTab {
  return ALMOND_TEMPLATE_STATUS_TABS.some((item) => item.value === value);
}

export default function AlmondTemplatesTemplate() {
  const [tab, setTab] = useState<AlmondTemplateTab>('all');
  const [kind, setKind] = useState(KIND_FILTER_ALL);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] =
    useState<AdminAlmondTemplateDto | null>(null);

  const { data, isLoading, isError, refetch } = useAlmondTemplates();
  const statusMutation = useUpdateAlmondTemplateStatus();
  const deleteMutation = useDeleteAlmondTemplate();

  const templates = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => countByTab(templates), [templates]);
  const kindOptions = useMemo(() => kindFilterOptions(templates), [templates]);
  const filtered = useMemo(
    () => filterAlmondTemplates(templates, { tab, kind, q }),
    [templates, tab, kind, q]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * PER_PAGE,
    currentPage * PER_PAGE
  );

  const newTemplateUrl = almondTemplateEditorUrl(
    STOREFRONT_URL,
    DEFAULT_COUNTRY
  );

  const handleToggleStatus = async (template: AdminAlmondTemplateDto) => {
    const next = template.status === 'published' ? 'draft' : 'published';
    try {
      await statusMutation.mutateAsync({ id: template.id, status: next });
      toast.success(
        next === 'published' ? '게시했습니다.' : '게시를 내렸습니다.'
      );
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('삭제했습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">아몬드템플릿</h1>
          <p className="text-muted-foreground text-sm">
            디자이너가 만든 인쇄물 시안 템플릿을 게시하거나 내리는 곳이에요.
            게시중인 템플릿만 고객 갤러리에 보여요.
          </p>
        </div>
        {newTemplateUrl ? (
          <Button asChild>
            <a href={newTemplateUrl} target="_blank" rel="noopener noreferrer">
              새 템플릿 만들기
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button disabled>새 템플릿 만들기</Button>
            <span className="text-muted-foreground text-xs">
              NEXT_PUBLIC_STOREFRONT_URL 환경변수 필요
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (!isAlmondTemplateTab(value)) return;
            setTab(value);
            setPage(1);
          }}
        >
          <TabsList>
            {ALMOND_TEMPLATE_STATUS_TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label} {counts[item.value].toLocaleString()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KIND_FILTER_ALL}>상품유형 전체</SelectItem>
              {kindOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="제목 검색"
            className="w-[200px]"
          />
        </div>
      </div>

      {isLoading && (
        <p className="text-muted-foreground py-10 text-center text-sm">
          불러오는 중…
        </p>
      )}

      {isError && (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-muted-foreground text-sm">
            템플릿 목록을 불러오지 못했어요.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
          >
            다시 시도
          </Button>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-muted-foreground text-sm">
            {templates.length === 0
              ? '아직 만든 템플릿이 없어요.'
              : '조건에 맞는 템플릿이 없어요.'}
          </p>
          {templates.length === 0 && newTemplateUrl && (
            <Button asChild className="mt-4">
              <a
                href={newTemplateUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                첫 템플릿 만들기
              </a>
            </Button>
          )}
        </div>
      )}

      <ul className="grid gap-3">
        {pageItems.map((template) => {
          const editUrl = almondTemplateEditorUrl(
            STOREFRONT_URL,
            DEFAULT_COUNTRY,
            template.id
          );
          const isToggling =
            statusMutation.isPending &&
            statusMutation.variables?.id === template.id;

          return (
            <li
              key={template.id}
              className="flex items-center gap-4 rounded-lg border p-3"
            >
              <div className="bg-muted relative h-24 w-24 shrink-0 overflow-hidden rounded">
                <div className="text-muted-foreground flex h-full items-center justify-center">
                  <ImageIcon className="h-6 w-6" />
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={almondTemplatesClient.thumbnailUrl(
                    template.id,
                    template.updatedAt
                  )}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{template.title}</span>
                  <Badge
                    variant={
                      template.status === 'published' ? 'default' : 'secondary'
                    }
                  >
                    {ALMOND_TEMPLATE_STATUS_LABELS[template.status]}
                  </Badge>
                  <Badge variant="outline">
                    {almondTemplateKindLabel(template.kind)}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {template.size}mm · {template.industry ?? '업종 없음'} ·{' '}
                  {template.purpose ?? '용도 없음'} · 수정{' '}
                  {formatDateTime(template.updatedAt)}
                </p>
                {template.colors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {template.colors.map((color) => (
                      <span
                        key={color}
                        title={color}
                        className="h-4 w-4 rounded-full border"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant={
                    template.status === 'published' ? 'outline' : 'default'
                  }
                  size="sm"
                  disabled={isToggling}
                  onClick={() => void handleToggleStatus(template)}
                >
                  {template.status === 'published' ? '게시 내리기' : '게시하기'}
                </Button>
                {editUrl ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={editUrl} target="_blank" rel="noopener noreferrer">
                      편집
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    편집
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(template)}
                >
                  삭제
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filtered.length}
          itemsPerPage={PER_PAGE}
          onPageChange={setPage}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>템플릿을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.title}</strong> 템플릿을 삭제합니다. 되돌릴
              수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleteMutation.isPending}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

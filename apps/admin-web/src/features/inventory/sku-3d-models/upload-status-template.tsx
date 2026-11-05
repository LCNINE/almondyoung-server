'use client';

import { useState, type FormEvent, type JSX } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
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
import { useCan } from '@/hooks/use-permission';
import { sku3dModelsClient } from '@/lib/api/domains/inventory/sku-3d-models.client';
import type {
  Sku3dModelUploadDto,
  Sku3dModelVisibility,
} from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  errorMessageOf,
  kstShortTime,
} from '../sku-field-capture/field-capture-model';
import { ModelPreviewDialog } from './model-preview-dialog';

const PAGE_SIZE = 50;

const VISIBILITIES: { value: Sku3dModelVisibility | null; label: string }[] = [
  { value: null, label: '전체' },
  { value: 'public', label: '공개' },
  { value: 'private', label: '비공개' },
];

type Pending = { kind: 'publish' | 'unpublish'; row: Sku3dModelUploadDto };

export default function Sku3dUploadStatusTemplate(): JSX.Element {
  const [qText, setQText] = useState('');
  const [uploaderText, setUploaderText] = useState('');
  const [q, setQ] = useState('');
  const [uploader, setUploader] = useState('');
  const [visibility, setVisibility] = useState<Sku3dModelVisibility | null>(
    null
  );
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(
    null
  );
  const queryClient = useQueryClient();
  const canWrite = useCan(['inventory.master.write']);
  const writeAllowed = canWrite.status === 'ready' && canWrite.allowed;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sku-3d-model-uploads', q, uploader, visibility, page],
    queryFn: () =>
      sku3dModelsClient.listUploads({
        q: q || undefined,
        uploader: uploader || undefined,
        visibility: visibility ?? undefined,
        page,
        limit: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const change = useMutation({
    mutationFn: async (target: Pending): Promise<void> => {
      if (target.kind === 'publish') {
        await sku3dModelsClient.publish(target.row.id);

        return;
      }

      await sku3dModelsClient.unpublish(target.row.skuId);
    },
    meta: { permission: ['inventory.master.write'] },
    onSuccess: async (_result, target) => {
      setPending(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sku-3d-model-uploads'] }),
        queryClient.invalidateQueries({
          queryKey: ['sku-3d-models', target.row.skuId],
        }),
      ]);
      toast.success(
        target.kind === 'publish'
          ? `v${target.row.version}를 공개했어요`
          : '3D를 비공개로 내렸어요'
      );
    },
    onError: (error) =>
      toast.error(errorMessageOf(error, '공개 상태를 바꾸지 못했어요')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(qText.trim());
    setUploader(uploaderText.trim());
    setPage(1);
  };

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex w-full max-w-[1200px] flex-col gap-y-4 p-3">
      <h1 className="text-lg font-semibold">3D 업로드 현황</h1>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 rounded-lg border px-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="상품명·SKU 코드"
            className="h-8 w-56 bg-transparent text-sm outline-none"
          />
        </label>
        <input
          value={uploaderText}
          onChange={(e) => setUploaderText(e.target.value)}
          placeholder="올린 사람"
          className="h-9 w-40 rounded-lg border px-2 text-sm outline-none"
        />
        <button
          type="submit"
          className="h-9 cursor-pointer rounded-lg border px-3 text-sm hover:bg-muted"
        >
          검색
        </button>
        <div className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          {VISIBILITIES.map((v) => (
            <button
              key={v.label}
              type="button"
              onClick={() => {
                setVisibility(v.value);
                setPage(1);
              }}
              className={
                v.value === visibility
                  ? 'cursor-pointer rounded-md bg-background px-3 py-1 text-sm font-semibold shadow-sm'
                  : 'cursor-pointer rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {v.label}
            </button>
          ))}
        </div>
      </form>

      {isLoading && (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      )}
      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>업로드 현황을 불러오지 못했어요</span>
          <button
            type="button"
            className="cursor-pointer rounded border px-2 py-1 hover:bg-muted"
            onClick={() => refetch()}
          >
            다시 시도
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">상품</th>
                  <th className="px-3 py-2 font-medium">버전</th>
                  <th className="px-3 py-2 font-medium">올린 사람</th>
                  <th className="px-3 py-2 font-medium">올린 시각</th>
                  <th className="px-3 py-2 font-medium">공개</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const isPublic = row.status === 'approved';
                  const glbUrl = row.glbFileId
                    ? resolvePublicFileUrl(row.glbFileId)
                    : null;

                  return (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">
                        <Link
                          href={`/inventory/sku-field-capture?q=${encodeURIComponent(row.skuCode)}`}
                          scroll={false}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.skuName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {row.skuCode}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">v{row.version}</td>
                      <td className="px-3 py-2">
                        {row.uploadedByLabel ?? '-'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {kstShortTime(row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isPublic}
                          aria-label={`${row.skuName} v${row.version} 공개`}
                          disabled={
                            !writeAllowed ||
                            change.isPending ||
                            (!isPublic && !row.glbFileId)
                          }
                          onClick={() =>
                            setPending({
                              kind: isPublic ? 'unpublish' : 'publish',
                              row,
                            })
                          }
                          className="group inline-flex cursor-pointer items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            className={`relative h-5 w-[34px] rounded-full transition-colors motion-reduce:transition-none ${
                              isPublic ? 'bg-foreground' : 'bg-zinc-300'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${
                                isPublic ? 'left-4' : 'left-0.5'
                              }`}
                            />
                          </span>
                          <span
                            className={
                              isPublic
                                ? 'font-semibold'
                                : 'text-muted-foreground'
                            }
                          >
                            {isPublic ? '공개' : '비공개'}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {glbUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setPreview({
                                  src: glbUrl,
                                  title: `${row.skuName} · v${row.version}`,
                                })
                              }
                              className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-muted"
                            >
                              3D 보기
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.items.length === 0 && (
                  <tr className="border-t">
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      조건에 맞는 업로드가 없어요
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {total.toLocaleString('ko-KR')}건
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="cursor-pointer rounded border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                이전
              </button>
              <span className="tabular-nums">
                {page} / {lastPage}
              </span>
              <button
                type="button"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
                className="cursor-pointer rounded border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                다음
              </button>
            </div>
          </div>
        </>
      )}

      <ModelPreviewDialog
        src={preview?.src ?? null}
        title={preview?.title ?? ''}
        onClose={() => setPreview(null)}
      />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'publish'
                ? `v${pending.row.version}를 공개할까요?`
                : '이 상품의 3D를 내릴까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'publish'
                ? '판매 중인 상품 상세에 3D로 보여요. 이 상품의 다른 공개 버전은 비공개로 바뀌어요'
                : '상품 상세에서 3D가 사라져요. 이 상품의 공개 버전이 모두 비공개로 바뀌어요'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending && (
            <p className="text-sm">
              {pending.row.skuName} · {pending.row.skuCode}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={change.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!writeAllowed || change.isPending || !pending}
              onClick={(event) => {
                event.preventDefault();

                if (pending && writeAllowed && !change.isPending) {
                  change.mutate(pending);
                }
              }}
            >
              {pending?.kind === 'publish' ? '공개하기' : '내리기'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

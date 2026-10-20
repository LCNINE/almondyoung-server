'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, RotateCw } from 'lucide-react';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

async function fetchAttachmentUrl(id: string) {
  const response = await fetchWithRefresh(
    `/api/proxy/file/files/${id}/download?expiresIn=300`
  );

  if (!response.ok) {
    throw new Error('사진을 불러오지 못했어요.');
  }

  const data: { signedUrl: string } = await response.json();

  return data.signedUrl;
}

function Attachment({
  id,
  index,
  onOpen,
}: {
  id: string;
  index: number;
  onOpen: (url: string) => void;
}) {
  const query = useQuery({
    queryKey: ['attendance', 'attachment', id],
    queryFn: () => fetchAttachmentUrl(id),
    staleTime: 240_000,
    gcTime: 300_000,
    retry: false,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = query.isError || (!!query.data && failedUrl === query.data);

  return (
    <button
      type="button"
      aria-label={
        failed
          ? `첨부 사진 ${index + 1} 다시 불러오기`
          : `첨부 사진 ${index + 1} 크게 보기`
      }
      disabled={query.isPending || query.isFetching}
      onClick={async () => {
        if (failed) {
          setFailedUrl(null);
          void query.refetch();
        } else if (Date.now() - query.dataUpdatedAt >= 240_000) {
          const result = await query.refetch();

          if (result.data && !result.error) {
            onOpen(result.data);
          }
        } else if (query.data) {
          onOpen(query.data);
        }
      }}
      className="relative aspect-square min-w-0 overflow-hidden rounded-2xl bg-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait"
    >
      {query.isPending ? (
        <Skeleton className="absolute inset-0 h-full w-full" />
      ) : failed ? (
        <span className="flex h-full flex-col items-center justify-center gap-2 px-2 text-xs text-slate-500">
          <RotateCw className="size-5" aria-hidden />
          다시 불러오기
        </span>
      ) : query.data ? (
        <Image
          unoptimized
          fill
          src={query.data}
          sizes="120px"
          alt={`요청에 첨부된 사진 ${index + 1}`}
          className="object-cover"
          onError={() => setFailedUrl(query.data!)}
        />
      ) : (
        <ImageIcon className="mx-auto size-5 text-slate-400" aria-hidden />
      )}
    </button>
  );
}

export function RequestAttachmentGallery({ fileIds }: { fileIds: string[] }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(
    null
  );
  const [previewError, setPreviewError] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function retryPreview() {
    if (!preview || previewLoading) {
      return;
    }

    setPreviewLoading(true);

    try {
      const url = await fetchAttachmentUrl(preview.id);

      queryClient.setQueryData(['attendance', 'attachment', preview.id], url);
      setPreview({ id: preview.id, url });
      setPreviewError(false);
    } catch {
      setPreviewError(true);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {fileIds.map((id, index) => (
          <Attachment
            key={id}
            id={id}
            index={index}
            onOpen={(url) => {
              setPreviewError(false);
              setPreview({ id, url });
            }}
          />
        ))}
      </div>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] gap-3 rounded-2xl p-4 sm:p-6">
          <DialogHeader className="pr-10">
            <DialogTitle>첨부 사진</DialogTitle>
          </DialogHeader>
          {preview &&
            (previewLoading ? (
              <Skeleton className="aspect-square w-full rounded-xl" />
            ) : previewError ? (
              <div
                role="alert"
                className="flex min-h-56 flex-col items-center justify-center gap-4 text-center"
              >
                <p className="text-sm text-slate-600">
                  사진을 불러오지 못했어요.
                </p>
                <button
                  type="button"
                  onClick={() => void retryPreview()}
                  className="min-h-11 rounded-xl bg-slate-100 px-5 text-sm font-semibold text-slate-700"
                >
                  다시 불러오기
                </button>
              </div>
            ) : (
              <Image
                unoptimized
                src={preview.url}
                width={1000}
                height={1000}
                alt="출결 요청 첨부 사진 확대"
                className="max-h-[75dvh] w-full object-contain"
                onError={() => setPreviewError(true)}
              />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}

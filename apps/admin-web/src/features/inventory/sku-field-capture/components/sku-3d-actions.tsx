'use client';

import { useRef, useState, type JSX } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  SKU_3D_MODEL_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { sku3dModelsClient } from '@/lib/api/domains/inventory/sku-3d-models.client';
import { errorMessageOf } from '../field-capture-model';
import { asGlbFile, glbFileProblem, modelSummary } from '../model-handoff';

export function Sku3dActions({
  skuId,
  code,
  name,
}: {
  skuId: string;
  code: string;
  name: string;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const canWrite = useCan(['inventory.master.write']);
  const models = useQuery({
    queryKey: ['sku-3d-models', skuId],
    queryFn: () => sku3dModelsClient.list(skuId),
  });

  const { publishedVersion, nextVersion } = modelSummary(models.data ?? []);
  const latestVersion = nextVersion - 1;
  const draftLabel =
    latestVersion > (publishedVersion ?? 0) ? `v${latestVersion} 비공개` : null;
  const statusLabel =
    publishedVersion !== null
      ? [`3D 공개 중 · v${publishedVersion}`, draftLabel]
          .filter(Boolean)
          .join(' · ')
      : (draftLabel ?? '3D 없음');
  const writeAllowed = canWrite.status === 'ready' && canWrite.allowed;
  const upload = useMutation({
    mutationFn: async (selected: File) => {
      const uploaded = await uploadFileToFileService(asGlbFile(selected), {
        contextId: SKU_3D_MODEL_CONTEXT_ID,
        isPublic: true,
        compress: false,
      });

      return sku3dModelsClient.register(skuId, uploaded.id);
    },
    meta: { permission: ['inventory.master.write'] },
    onSuccess: async (model) => {
      setFile(null);
      await queryClient.invalidateQueries({
        queryKey: ['sku-3d-models', skuId],
      });
      toast.success(`v${model.version}를 비공개로 올렸어요`);
    },
    onError: (error) =>
      toast.error(errorMessageOf(error, '3D 모델을 올리지 못했어요')),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {models.data && (
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
      )}
      <Link
        href={`/mobile/sku-3d-workshop/${encodeURIComponent(skuId)}?back=${encodeURIComponent('/inventory/sku-field-capture')}`}
        className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-muted"
      >
        3D 작업실
      </Link>
      <button
        type="button"
        disabled={!writeAllowed || upload.isPending}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {publishedVersion !== null ? 'GLB 다시 올리기' : 'GLB 업로드'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];

          event.currentTarget.value = '';

          if (!selected) {
            return;
          }

          const problem = glbFileProblem(selected);

          if (problem) {
            toast.error(problem);

            return;
          }

          setFile(selected);
        }}
      />
      <a
        href={`/inventory/skus?code=${encodeURIComponent(code)}`}
        target="_blank"
        rel="noreferrer"
        className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-muted"
      >
        상세
      </a>

      <AlertDialog
        open={file !== null}
        onOpenChange={(open) => !open && setFile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>3D 모델을 올릴까요?</AlertDialogTitle>
            <AlertDialogDescription>
              비공개로 올라가요. 상품 상세에 보이게 하려면 3D 업로드 현황에서
              공개해 주세요
            </AlertDialogDescription>
          </AlertDialogHeader>
          {file && (
            <div className="space-y-1 text-sm">
              <p>{name}</p>
              <p className="break-all">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
              </p>
              <p>v{nextVersion} 비공개</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={upload.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!writeAllowed || upload.isPending || !file}
              onClick={(event) => {
                event.preventDefault();

                if (file && writeAllowed && !upload.isPending) {
                  upload.mutate(file);
                }
              }}
            >
              올리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

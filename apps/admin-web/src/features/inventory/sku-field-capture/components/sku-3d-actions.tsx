'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCan } from '@/hooks/use-permission';
import {
  SKU_3D_MODEL_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { sku3dModelsClient } from '@/lib/api/domains/inventory/sku-3d-models.client';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import { errorMessageOf, fieldCaptureKeys } from '../field-capture-model';
import {
  asGlbFile,
  buildModelPrompt,
  chatGptAppUrl,
  glbFileProblem,
  handoffBlockedReason,
  modelSummary,
  photoUrlsOf,
} from '../model-handoff';

const DOWNLOADS_FOLDER_KEY = 'sku-field-capture:downloads-folder';

function downloadsFolder(): string | null {
  const saved = window.localStorage.getItem(DOWNLOADS_FOLDER_KEY);

  if (saved) {
    return saved;
  }

  const entered = window
    .prompt(
      '사진을 받을 내려받기 폴더 경로를 적어 주세요',
      '/Users/이름/Downloads'
    )
    ?.trim();

  if (!entered) {
    return null;
  }

  window.localStorage.setItem(DOWNLOADS_FOLDER_KEY, entered);

  return entered;
}

async function downloadPhotos(photoUrls: string[], code: string) {
  const blobs = await Promise.all(
    photoUrls.map(async (url) => {
      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error('Photo download failed');
      }

      return response.blob();
    })
  );

  for (const [i, blob] of blobs.entries()) {
    const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg';
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = `${code}-${i + 1}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

export function Sku3dActions({
  skuId,
  code,
  name,
  dims,
}: {
  skuId: string;
  code: string;
  name: string;
  dims: {
    packageWidthMm: number | null;
    packageLengthMm: number | null;
    packageHeightMm: number | null;
    packageWeightG: number | null;
  };
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const queryClient = useQueryClient();
  const canWrite = useCan(['inventory.master.write']);
  const models = useQuery({
    queryKey: ['sku-3d-models', skuId],
    queryFn: () => sku3dModelsClient.list(skuId),
  });

  const { publishedVersion, nextVersion } = modelSummary(models.data ?? []);
  const writeAllowed = canWrite.status === 'ready' && canWrite.allowed;
  const missingMeasurements = [
    dims.packageWidthMm,
    dims.packageLengthMm,
    dims.packageHeightMm,
    dims.packageWeightG,
  ].some((value) => value === null || value === 0);

  const publish = useMutation({
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
      toast.success(`v${model.version} 을 공개했어요`);
    },
    onError: (error) =>
      toast.error(errorMessageOf(error, '3D 모델을 공개하지 못했어요')),
  });

  const handoff = async () => {
    const folder = downloadsFolder();

    if (!folder) {
      return;
    }

    setHandingOff(true);

    try {
      const detail = await queryClient.fetchQuery({
        queryKey: fieldCaptureKeys.detail(skuId),
        queryFn: () => skuFieldCaptureClient.getDetail(skuId),
        staleTime: 0,
      });

      if (!mounted.current) {
        return;
      }

      const reason = handoffBlockedReason(detail);

      if (reason) {
        toast.error(reason);

        return;
      }

      const appLink = document.createElement('a');

      appLink.href = chatGptAppUrl(folder, buildModelPrompt(detail));
      appLink.click();
      await downloadPhotos(photoUrlsOf(detail, window.location.origin), code);
      toast.success(
        `ChatGPT 앱을 열고 사진 ${detail.photos.length}장을 내려받았어요`,
        {
          description: '앱에서 전송을 눌러 주세요',
        }
      );
    } catch (error) {
      toast.error(errorMessageOf(error, 'ChatGPT 앱으로 넘기지 못했어요'));
    } finally {
      setHandingOff(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {models.data && (
        <span className="text-xs text-muted-foreground">
          {publishedVersion !== null
            ? `3D 공개 중 · v${publishedVersion}`
            : '3D 없음'}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={missingMeasurements ? 0 : undefined}>
            <button
              type="button"
              disabled={missingMeasurements || handingOff}
              onClick={() => void handoff()}
              className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            >
              지피티로 가기
            </button>
          </span>
        </TooltipTrigger>
        {missingMeasurements && (
          <TooltipContent>실측 정보가 비어 있어요</TooltipContent>
        )}
      </Tooltip>
      <button
        type="button"
        disabled={!writeAllowed || publish.isPending}
        onClick={() => inputRef.current?.click()}
        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
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
        className="rounded border px-2 py-1 text-xs"
      >
        상세
      </a>

      <AlertDialog
        open={file !== null}
        onOpenChange={(open) => !open && setFile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>3D 모델을 공개할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              공개하면 판매 중인 상품 상세에 3D로 보기가 생겨요
            </AlertDialogDescription>
          </AlertDialogHeader>
          {file && (
            <div className="space-y-1 text-sm">
              <p>{name}</p>
              <p className="break-all">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
              </p>
              <p>
                {publishedVersion !== null
                  ? `v${publishedVersion} → v${nextVersion}`
                  : `v${nextVersion}`}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publish.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!writeAllowed || publish.isPending || !file}
              onClick={(event) => {
                event.preventDefault();

                if (file && writeAllowed && !publish.isPending) {
                  publish.mutate(file);
                }
              }}
            >
              공개하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { FieldCaptureDetailDto, ReferencePhotoDto } from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { MIN_REFERENCE_PHOTOS, REFERENCE_PHOTO_CONTEXT_ID, errorMessageOf, photoRejectionReason } from '../field-capture-model';

type Props = {
  skuId: string;
  photos: ReferencePhotoDto[];
  /** 서버가 돌려준 상세 — 화면의 사진은 언제나 서버가 아는 사진이다 */
  onDetail: (detail: FieldCaptureDetailDto) => void;
  /** 쓰기 권한이 확인되지 않았으면 찍기·지우기를 막는다 */
  disabled?: boolean;
};

export function ReferencePhotoField({ skuId, photos, onDetail, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  // 서버 쓰기(연결·해제)는 한 줄로 세운다. 응답마다 상세 캐시를 통째로 갈아끼우므로, 병렬이면 늦게 온
  // 옛 응답이 이겨 사진 수가 줄거나 지운 사진이 되살아난다. 파일 업로드 자체는 병렬로 둔다(계속 찍게).
  const writes = useRef<Promise<void>>(Promise.resolve());
  const serially = (write: () => Promise<FieldCaptureDetailDto>, failure: string): Promise<void> => {
    const run = writes.current.then(async () => {
      try {
        onDetail(await write());
      } catch (err) {
        toast.error(errorMessageOf(err, failure));
      }
    });
    writes.current = run;
    return run;
  };

  const addOne = async (file: File) => {
    setUploading((n) => n + 1);
    try {
      let fileId: string;
      try {
        ({ id: fileId } = await uploadFileToFileService(file, {
          contextId: REFERENCE_PHOTO_CONTEXT_ID,
          isPublic: true,
          compress: false,
        }));
      } catch (err) {
        toast.error(errorMessageOf(err, '사진을 올리지 못했어요. 다시 찍어 주세요'));
        return;
      }
      // 올라갔어도 연결이 안 되면 화면에도 안 보인다 — 다시 찍게 한다
      await serially(
        () => skuFieldCaptureClient.attachPhoto(skuId, fileId),
        '사진을 상품에 연결하지 못했어요. 다시 찍어 주세요',
      );
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일을 다시 골라도 onChange 가 오게
    for (const file of files) {
      const reason = photoRejectionReason(file);
      if (reason) toast.error(reason);
      else void addOne(file);
    }
  };

  const remove = async (photoId: string) => {
    setRemoving((s) => new Set(s).add(photoId));
    await serially(() => skuFieldCaptureClient.removePhoto(skuId, photoId), '사진을 지우지 못했어요');
    setRemoving((s) => {
      const next = new Set(s);
      next.delete(photoId);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => {
          const src = resolvePublicFileUrl(p.fileId);
          return (
            <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-lg bg-gray-200">
              {src && (
                // eslint-disable-next-line @next/next/no-img-element -- file-service 공개 URL, next/image 도메인 설정 밖
                <img src={src} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={disabled || removing.has(p.id)}
                aria-label="사진 지우기"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white disabled:opacity-50"
              >
                {removing.has(p.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className="flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-white text-xs text-gray-600 disabled:opacity-40"
        >
          <Camera className="h-5 w-5" />
          찍기
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        hidden
        onChange={addFiles}
      />
      <p className="text-xs text-gray-500">
        {photos.length}/{MIN_REFERENCE_PHOTOS}장 이상
      </p>
    </div>
  );
}

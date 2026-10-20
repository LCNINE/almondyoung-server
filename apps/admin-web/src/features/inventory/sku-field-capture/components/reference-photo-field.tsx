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
  const [removing, setRemoving] = useState<string | null>(null);

  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일을 다시 골라도 onChange 가 오게
    for (const file of files) {
      const reason = photoRejectionReason(file);
      if (reason) {
        toast.error(reason);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const uploaded = await uploadFileToFileService(file, {
          contextId: REFERENCE_PHOTO_CONTEXT_ID,
          isPublic: true,
          compress: false,
        });
        try {
          onDetail(await skuFieldCaptureClient.attachPhoto(skuId, uploaded.id));
        } catch (err) {
          // 올라갔지만 이 상품에 연결되지 않았다 — 화면에도 안 보이니 다시 찍게 한다
          toast.error(errorMessageOf(err, '사진을 상품에 연결하지 못했어요. 다시 찍어 주세요'));
        }
      } catch (err) {
        toast.error(errorMessageOf(err, '사진을 올리지 못했어요. 다시 찍어 주세요'));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const remove = async (photoId: string) => {
    setRemoving(photoId);
    try {
      onDetail(await skuFieldCaptureClient.removePhoto(skuId, photoId));
    } catch (err) {
      toast.error(errorMessageOf(err, '사진을 지우지 못했어요'));
    } finally {
      setRemoving(null);
    }
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
                disabled={disabled || removing !== null}
                aria-label="사진 지우기"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white disabled:opacity-50"
              >
                {removing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
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

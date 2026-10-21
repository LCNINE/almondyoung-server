'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { FieldCaptureDetailDto, ReferencePhotoDto } from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  MIN_REFERENCE_PHOTOS,
  REFERENCE_PHOTO_CONTEXT_ID,
  cameraUnavailableReason,
  errorMessageOf,
  photoRejectionReason,
} from '../field-capture-model';
import { PhotoCamera } from './photo-camera';

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
  // 올리는 중인 사진의 로컬 미리보기 — 찍자마자 보이고 위에 「올리는 중」만 덮는다
  const [pending, setPending] = useState<string[]>([]);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [cameraOpen, setCameraOpen] = useState(false);
  // 화면 안 카메라를 못 쓰면(권한 거부·미지원) 이 화면에선 폰 카메라 앱으로 찍는다
  const [nativeOnly, setNativeOnly] = useState(false);
  // 방금 찍은 사진은 서버에서 다시 받지 않고 찍은 파일로 보여 준다 — 다시 받는 요청이 늦거나 실패하면 엑박이 떴다.
  // 연결 응답(onDetail)이 화면을 다시 그리므로 상태가 아니라 ref 로 둔다
  const localPreviews = useRef(new Map<string, string>());
  useEffect(() => {
    const previews = localPreviews.current;
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, []);
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
    const preview = URL.createObjectURL(file);
    setPending((p) => [...p, preview]);
    let kept = false;
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
      localPreviews.current.set(fileId, preview);
      kept = true;
      // 올라갔어도 연결이 안 되면 화면에도 안 보인다 — 다시 찍게 한다
      await serially(
        () => skuFieldCaptureClient.attachPhoto(skuId, fileId),
        '사진을 상품에 연결하지 못했어요. 다시 찍어 주세요',
      );
    } finally {
      setPending((p) => p.filter((u) => u !== preview));
      if (!kept) URL.revokeObjectURL(preview);
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

  const openCamera = () => {
    const inPage =
      !nativeOnly &&
      cameraUnavailableReason({
        isSecureContext: window.isSecureContext,
        hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
      }) === null;
    if (inPage) setCameraOpen(true);
    else inputRef.current?.click();
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
          const src = localPreviews.current.get(p.fileId) ?? resolvePublicFileUrl(p.fileId);
          return (
            <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-lg bg-gray-200">
              {src && <PhotoImg src={src} />}
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={disabled || removing.has(p.id)}
                aria-label="사진 지우기"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white disabled:opacity-50"
              >
                {removing.has(p.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
        {pending.map((url) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-lg bg-gray-200">
            <PhotoImg src={url} />
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-semibold text-white">
              올리는 중
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={openCamera}
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
        {pending.length > 0 && ` · ${pending.length}장 올리는 중`}
      </p>
      {cameraOpen && (
        <PhotoCamera
          count={photos.length + pending.length}
          min={MIN_REFERENCE_PHOTOS}
          onShot={(file) => void addOne(file)}
          onFail={() => {
            setCameraOpen(false);
            setNativeOnly(true);
            toast.error('카메라를 열지 못했어요 — 찍기를 다시 누르면 폰 카메라로 찍어요');
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

// 서버 사진은 한 번 실패해도 바로 엑박으로 두지 않고 주소를 바꿔 한 번 더 받는다 — 일시 실패가 화면에 남던 것
function PhotoImg({ src }: { src: string }) {
  const [retried, setRetried] = useState(false);
  const shown = retried && !src.startsWith('blob:') ? `${src}?retry=1` : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- file-service 공개 URL·로컬 미리보기, next/image 도메인 설정 밖
    <img src={shown} alt="" onError={() => setRetried(true)} className="h-full w-full object-cover" />
  );
}

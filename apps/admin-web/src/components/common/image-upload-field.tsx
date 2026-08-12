'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Check, ImageIcon, Loader2, Upload, X, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  compressImageForUpload,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from '@/lib/utils/image-compress';
import { cropImageToArea, type CropArea } from '@/lib/utils/image-crop';

type Props = {
  label: string;
  /** file-service fileId. 비어 있으면 미선택 상태 */
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  /** file_contexts 시드의 컨텍스트 ID (예: banner-image) */
  contextId: string;
  description?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** 미리보기 박스 비율 — 배너처럼 가로로 긴 이미지는 'wide' */
  previewShape?: 'square' | 'wide';
  /**
   * 이미지가 실제로 노출될 슬롯의 비율. 미리보기를 그 비율 + object-cover 로 그려
   * 화면에서 잘리는 모습을 업로드 시점에 그대로 보여주고, 파일을 고르면 쓸 영역을
   * 직접 정한 뒤 그 부분만 잘라서 올린다. previewShape 보다 우선한다.
   */
  slotRatio?: { width: number; height: number } | null;
  /**
   * 미리보기 최대 폭(px). 모바일 배너는 폰에서 좁게 보이므로 미리보기도 좁혀야
   * 실제 크기 감각이 맞는다. 없으면 가용 폭을 다 쓴다.
   */
  previewMaxWidth?: number;
  /**
   * 이 이미지가 실제로 노출될 화면 폭(px). 미리보기 박스 아래에 실제 크기를 적어
   * "축소해서 보여주는 중"인지 "실물 크기"인지 구분되게 한다 — 다이얼로그 폭에는
   * PC 뷰포트(1440px)가 안 들어가서 두 박스가 비슷한 크기로 보이기 때문.
   */
  targetViewportWidth?: number;
};

type Pending = { file: File; objectUrl: string };

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
/** 크롭 작업 영역 높이(px). 원본 전체가 보일 만큼 넉넉해야 위치를 고를 수 있다 */
const CROP_BOX_HEIGHT = 300;

/**
 * file-service 에 이미지를 올리고 fileId 를 돌려주는 공용 입력.
 *
 * 이전에는 화면마다 "업로드는 따로 하고 파일 ID 를 손으로 붙여넣는" 형태가 있었는데,
 * 관리자가 ID 를 얻을 경로가 없어 사실상 입력이 불가능했다. 업로드·미리보기·제거를
 * 한 컴포넌트 안에서 끝내 그 구멍을 없앤다.
 */
export function ImageUploadField({
  label,
  value,
  onChange,
  contextId,
  description,
  required,
  disabled,
  previewShape = 'square',
  slotRatio,
  previewMaxWidth,
  targetViewportWidth,
}: Props) {
  const [uploading, setUploading] = useState(false);
  /** 자동으로 줄여서 올렸을 때 무슨 일이 있었는지 알려준다. */
  const [compressNote, setCompressNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const src = resolvePublicFileUrl(value);
  const ratio = slotRatio ? slotRatio.width / slotRatio.height : null;

  // 미리보기용 objectURL 은 컴포넌트가 사라질 때 반드시 회수한다
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.objectUrl);
    };
  }, [pending]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  const clearPending = () => {
    if (pending) URL.revokeObjectURL(pending.objectUrl);
    setPending(null);
    setCrop({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
    setCroppedArea(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const upload = async (file: File) => {
    setUploading(true);
    setCompressNote(null);
    try {
      const {
        file: toUpload,
        compressed,
        originalBytes,
      } = await compressImageForUpload(file);

      // 줄이고도 상한을 넘으면 프록시가 413 으로 끊는다. 개발자용 상태코드 대신
      // 무엇을 해야 하는지 알려준다.
      if (toUpload.size > MAX_UPLOAD_BYTES) {
        toast.error(
          `이미지가 너무 큽니다 (${formatBytes(toUpload.size)}). ${formatBytes(MAX_UPLOAD_BYTES)} 이하로 줄여서 올려주세요.`
        );
        return;
      }

      const res = await uploadFileToFileService(toUpload, {
        contextId,
        isPublic: true,
      });
      onChange(res.id);
      clearPending();

      if (compressed) {
        setCompressNote(
          `용량이 커서 ${formatBytes(originalBytes)} → ${formatBytes(toUpload.size)} 로 줄여서 올렸습니다.`
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : '이미지 업로드에 실패했습니다.'
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    // 슬롯 비율을 모르면 어디를 남길지 물어볼 수 없다 — 예전처럼 바로 올린다
    if (!ratio) {
      void upload(file);
      return;
    }

    setPending({ file, objectUrl: URL.createObjectURL(file) });
    setCrop({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
    setCroppedArea(null);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    try {
      const file = croppedArea
        ? await cropImageToArea(pending.file, croppedArea)
        : pending.file;
      await upload(file);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : '이미지를 자르지 못했습니다.'
      );
    }
  };

  const boxClass = slotRatio
    ? 'w-full'
    : previewShape === 'wide'
      ? 'h-20 w-36'
      : 'h-20 w-20';
  const boxStyle: React.CSSProperties | undefined = slotRatio
    ? {
        aspectRatio: `${slotRatio.width} / ${slotRatio.height}`,
        maxWidth: previewMaxWidth,
      }
    : undefined;

  return (
    <div className="grid gap-2">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
        {pending && ratio && (
          <span className="text-muted-foreground ml-1 font-normal">
            — 잘라낼 영역 선택 중
          </span>
        )}
      </Label>
      {description && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>
      )}

      {/*
        크롭 중에는 작업 영역을 슬롯 비율이 아니라 넉넉한 고정 높이로 둔다.
        컨테이너를 슬롯 비율(예: 3:1)로 잡으면 그보다 세로로 긴 원본이 높이에 갇혀
        아주 작게 표시된다 — 잘라낼 위치를 고를 수가 없다.
      */}
      <div
        className={
          pending && ratio
            ? 'relative w-full overflow-hidden rounded-md border bg-neutral-800'
            : `bg-muted relative overflow-hidden rounded-md border ${boxClass}`
        }
        style={pending && ratio ? { height: CROP_BOX_HEIGHT } : boxStyle}
      >
        {pending && ratio ? (
          <Cropper
            image={pending.objectUrl}
            crop={crop}
            zoom={zoom}
            aspect={ratio}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            showGrid={false}
          />
        ) : src ? (
          // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={label}
            className={`h-full w-full ${slotRatio ? 'object-cover' : 'object-contain'}`}
          />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </div>

      {pending && ratio && (
        <div className="grid gap-1">
          <p className="text-muted-foreground text-[11px]">
            밝은 영역이 실제로 보이는 부분입니다. 드래그해서 위치를 잡고,
            아래에서 확대할 수 있습니다
          </p>
          <div className="flex items-center gap-2">
            <ZoomIn className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <Slider
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              disabled={uploading}
            />
            <span className="text-muted-foreground w-10 shrink-0 text-right text-[11px]">
              {zoom.toFixed(1)}x
            </span>
          </div>
        </div>
      )}

      {slotRatio && targetViewportWidth && !pending && (
        <p className="text-muted-foreground/70 text-[11px]">
          {previewMaxWidth && previewMaxWidth >= targetViewportWidth
            ? `실제 화면(${targetViewportWidth}px)과 같은 크기입니다`
            : `실제 화면은 ${targetViewportWidth}px 폭 — 여기서는 축소해서 보여줍니다`}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
      />

      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => void handleConfirm()}
            >
              {uploading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" />
              )}
              이대로 업로드
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={clearPending}
            >
              취소
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {value ? '이미지 변경' : '이미지 업로드'}
            </Button>
            {value && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={disabled || uploading}
                onClick={() => onChange(null)}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                제거
              </Button>
            )}
          </>
        )}
        <span className="text-muted-foreground/70 ml-auto text-[11px]">
          {formatBytes(MAX_UPLOAD_BYTES)} 이하
        </span>
      </div>

      {compressNote && (
        <p className="text-muted-foreground text-xs">{compressNote}</p>
      )}
    </div>
  );
}

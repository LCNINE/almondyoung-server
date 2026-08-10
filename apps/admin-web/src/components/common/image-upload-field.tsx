'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  compressImageForUpload,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from '@/lib/utils/image-compress';

type Props = {
  label: string;
  /** file-service fileId. 비어 있으면 미선택 상태 */
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  /** file_contexts 시드의 컨텍스트 ID (예: banner-image) */
  contextId: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  /** 미리보기 박스 비율 — 배너처럼 가로로 긴 이미지는 'wide' */
  previewShape?: 'square' | 'wide';
};

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
}: Props) {
  const [uploading, setUploading] = useState(false);
  /** 자동으로 줄여서 올렸을 때 무슨 일이 있었는지 알려준다. */
  const [compressNote, setCompressNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const src = resolvePublicFileUrl(value);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    setUploading(true);
    setCompressNote(null);
    try {
      const { file: upload, compressed, originalBytes } = await compressImageForUpload(file);

      // 줄이고도 상한을 넘으면 프록시가 413 으로 끊는다. 개발자용 상태코드 대신
      // 무엇을 해야 하는지 알려준다.
      if (upload.size > MAX_UPLOAD_BYTES) {
        toast.error(
          `이미지가 너무 큽니다 (${formatBytes(upload.size)}). ${formatBytes(MAX_UPLOAD_BYTES)} 이하로 줄여서 올려주세요.`,
        );
        return;
      }

      const res = await uploadFileToFileService(upload, { contextId, isPublic: true });
      onChange(res.id);

      if (compressed) {
        setCompressNote(
          `용량이 커서 ${formatBytes(originalBytes)} → ${formatBytes(upload.size)} 로 줄여서 올렸습니다.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {description && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      <p className="text-muted-foreground text-xs">
        {formatBytes(MAX_UPLOAD_BYTES)}까지 올릴 수 있고, 더 큰 이미지는 자동으로 줄여서 올립니다.
      </p>
      <div className="flex items-start gap-3">
        <div
          className={`bg-muted relative shrink-0 overflow-hidden rounded-md border ${
            previewShape === 'wide' ? 'h-20 w-36' : 'h-20 w-20'
          }`}
        >
          {src ? (
            // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={label} className="h-full w-full object-contain" />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? undefined)}
          />
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
        </div>
      </div>

      {compressNote && <p className="text-muted-foreground text-xs">{compressNote}</p>}
    </div>
  );
}

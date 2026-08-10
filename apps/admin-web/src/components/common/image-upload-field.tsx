'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

type Props = {
  label: string;
  /** file-service fileId. 비어 있으면 미선택 상태 */
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  /** file_contexts 시드의 컨텍스트 ID (예: site-popup-image) */
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
  const inputRef = useRef<HTMLInputElement>(null);

  const src = resolvePublicFileUrl(value);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    setUploading(true);
    try {
      const res = await uploadFileToFileService(file, { contextId, isPublic: true });
      onChange(res.id);
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
    </div>
  );
}

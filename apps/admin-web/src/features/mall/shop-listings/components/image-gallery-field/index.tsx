'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { compressImageForUpload, formatBytes } from '@/lib/utils/image-compress';
import { cn } from '@/lib/utils';
import { CropDialog } from './crop-dialog';

/** 사고 방지용 상한. 실제 권장은 8~10장이라 여기에 닿을 일은 거의 없다. */
const MAX_IMAGES = 15;
/** file_contexts 의 notice-content-image 정책과 맞춘다 (서버도 같은 값으로 거른다) */
const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  /** file-service fileId 목록. 배열 순서가 곧 노출 순서 */
  value: string[];
  onChange: (fileIds: string[]) => void;
  contextId: string;
  disabled?: boolean;
};

export function ImageGalleryField({
  value,
  onChange,
  contextId,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [cropTarget, setCropTarget] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith('image/'));
    if (picked.length === 0) return;

    const room = MAX_IMAGES - value.length;
    if (room <= 0) {
      toast.error(`사진은 ${MAX_IMAGES}장까지만 올릴 수 있어요.`, {
        id: 'gallery-max-images',
      });
      return;
    }
    if (picked.length > room) {
      toast.info(`${MAX_IMAGES}장까지만 올릴 수 있어 ${room}장만 올립니다.`, {
        id: 'gallery-max-images',
      });
    }

    setUploading(true);
    const added: string[] = [];
    const failed: string[] = [];

    // 한 장이 실패해도 나머지는 계속 올린다 — 여러 장 올릴 때 중간에 끊기면 곤란하다.
    for (const file of picked.slice(0, room)) {
      try {
        const { file: toUpload } = await compressImageForUpload(file);
        if (toUpload.size > MAX_BYTES) {
          failed.push(`${file.name} (${formatBytes(toUpload.size)})`);
          continue;
        }
        const { id } = await uploadFileToFileService(toUpload, {
          contextId,
          isPublic: true,
        });
        added.push(id);
      } catch {
        failed.push(file.name);
      }
    }

    setUploading(false);
    if (added.length > 0) onChange([...value, ...added]);
    if (failed.length > 0) {
      toast.error(`${failed.length}장을 올리지 못했어요.`, {
        id: 'gallery-upload-failed',
        description: `${failed.join(', ')} — 사진 한 장은 ${formatBytes(MAX_BYTES)} 이하여야 합니다.`,
        duration: 8000,
      });
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void addFiles(files);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  /** 썸네일을 끌어다 놓아 순서를 바꾼다 */
  const moveTo = (to: number) => {
    if (dragFrom === null || dragFrom === to) return;
    const next = [...value];
    const [moved] = next.splice(dragFrom, 1);
    next.splice(to, 0, moved);
    setDragFrom(null);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>
          샵 사진
          <span
            className={cn(
              'ml-1 text-xs font-normal',
              value.length >= MAX_IMAGES
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
          >
            {value.length}/{MAX_IMAGES}
          </span>
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading || value.length >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          사진 추가
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        상세 화면 맨 위에 슬라이드로 보여줍니다. 썸네일을 끌어다 놓아 순서를
        바꿀 수 있고, <strong>맨 앞 사진이 대표 사진</strong>이 되어 목록 카드와
        공유 미리보기에 쓰입니다. 더블클릭하면 잘라낼 수 있어요. 8~10장을
        권합니다.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (dragFrom === null) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-lg border border-dashed p-3 transition-colors',
          dragOver && 'border-primary bg-primary/5'
        )}
      >
        {value.length === 0 ? (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="text-muted-foreground hover:text-foreground flex w-full flex-col items-center gap-1 py-8 text-sm"
          >
            <ImagePlus className="h-6 w-6" />
            사진을 끌어다 놓거나 눌러서 선택하세요
          </button>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {value.map((fileId, index) => (
              <li
                key={fileId}
                draggable={!disabled}
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  moveTo(index);
                }}
                onDoubleClick={() => !disabled && setCropTarget(fileId)}
                title="더블클릭하면 사진을 자를 수 있어요"
                className={cn(
                  'bg-muted group relative aspect-square overflow-hidden rounded border',
                  disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                  dragFrom === index && 'opacity-40'
                )}
              >
                {/* file-service 프록시 경유 이미지라 next/image 를 쓰면 엑박이 된다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolvePublicFileUrl(fileId) ?? ''}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span
                  className={cn(
                    'absolute left-1 top-1 rounded px-1.5 text-[10px]',
                    index === 0
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-black/60 text-white'
                  )}
                >
                  {index === 0 ? '대표' : index + 1}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                  aria-label="사진 삭제"
                  className="absolute right-1 top-1 cursor-pointer rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPick}
      />

      <CropDialog
        fileId={cropTarget}
        contextId={contextId}
        onClose={() => setCropTarget(null)}
        onCropped={(newFileId) =>
          onChange(value.map((id) => (id === cropTarget ? newFileId : id)))
        }
      />
    </div>
  );
}

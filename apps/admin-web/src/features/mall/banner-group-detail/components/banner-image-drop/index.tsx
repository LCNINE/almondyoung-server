'use client';

import { useRef, useState } from 'react';
import { ImageIcon, ImageUp, Loader2, X } from 'lucide-react';
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
import { toast } from 'sonner';
import {
  IMAGE_CONTEXT_MAX_BYTES,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  compressImageForUpload,
  formatBytes,
} from '@/lib/utils/image-compress';
import { cropImageToArea, loadImage } from '@/lib/utils/image-crop';

type Slot = { width: number; height: number } | null;

type Props = {
  contextId: string;
  pcSlot: Slot;
  mobileSlot: Slot;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  onChange: (patch: {
    pcImageFileId?: string;
    mobileImageFileId?: string;
  }) => void;
  disabled?: boolean;
};

/** 원본 가운데에서 목표 비율만큼 잘라낼 영역 */
function centerArea(width: number, height: number, ratio: number) {
  if (width / height > ratio) {
    const w = height * ratio;
    return { x: (width - w) / 2, y: 0, width: w, height };
  }
  const h = width / ratio;
  return { x: 0, y: (height - h) / 2, width, height: h };
}

export function BannerImageDrop({
  contextId,
  pcSlot,
  mobileSlot,
  pcImageFileId,
  mobileImageFileId,
  onChange,
  disabled,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 개별 교체 중인 줄 */
  const [busyRow, setBusyRow] = useState<'pc' | 'mobile' | null>(null);
  /** 이미 올라간 이미지를 덮어쓰기 전에 확인받는다 */
  const [confirmFile, setConfirmFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pcInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const rows = [
    {
      key: 'pc' as const,
      label: 'PC',
      slot: pcSlot,
      fileId: pcImageFileId,
      inputRef: pcInputRef,
    },
    {
      key: 'mobile' as const,
      label: '모바일',
      slot: mobileSlot,
      fileId: mobileImageFileId,
      inputRef: mobileInputRef,
    },
  ];
  /** 한 장이라도 올라와야 줄을 보여준다 — 그 전에는 드롭존만 */
  const hasAny = !!(pcImageFileId || mobileImageFileId);

  const uploadFor = async (file: File, slot: Slot) => {
    let toSend = file;
    if (slot) {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImage(url);
        toSend = await cropImageToArea(
          file,
          centerArea(
            img.naturalWidth,
            img.naturalHeight,
            slot.width / slot.height
          )
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const { file: compressed } = await compressImageForUpload(toSend);
    if (compressed.size > IMAGE_CONTEXT_MAX_BYTES) {
      throw new Error(
        `이미지가 너무 큽니다 (${formatBytes(compressed.size)}). ${formatBytes(IMAGE_CONTEXT_MAX_BYTES)} 이하로 줄여 주세요.`
      );
    }
    const res = await uploadFileToFileService(compressed, {
      contextId,
      isPublic: true,
      compress: false,
    });
    return res.id;
  };

  const handleFile = (file: File | undefined) => {
    if (!file || disabled || busy) return;
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 올릴 수 있습니다.');
      return;
    }
    if (pcImageFileId || mobileImageFileId) {
      setConfirmFile(file);
      return;
    }
    void applyFile(file);
  };

  const applyFile = async (file: File) => {
    setBusy(true);
    try {
      const [pc, mobile] = await Promise.all([
        uploadFor(file, pcSlot),
        uploadFor(file, mobileSlot),
      ]);
      onChange({ pcImageFileId: pc, mobileImageFileId: mobile });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '업로드에 실패했습니다.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  /** 한 칸만 다른 그림으로 바꾼다 */
  const replaceOne = async (key: 'pc' | 'mobile', file: File | undefined) => {
    if (!file || disabled || busy) return;
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 올릴 수 있습니다.');
      return;
    }
    setBusyRow(key);
    try {
      const id = await uploadFor(file, key === 'pc' ? pcSlot : mobileSlot);
      onChange(
        key === 'pc' ? { pcImageFileId: id } : { mobileImageFileId: id }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '업로드에 실패했습니다.');
    } finally {
      setBusyRow(null);
    }
  };

  return (
    <div className="grid gap-3">
      <div
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 text-center transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'hover:border-primary/60 border-[#e4e4e7] bg-[#fafafa]'
        }`}
      >
        {busy ? (
          <Loader2 className="text-primary h-8 w-8 animate-spin" />
        ) : (
          <ImageUp
            className={`h-8 w-8 ${dragOver ? 'text-primary' : 'text-[#c6c6ca]'}`}
          />
        )}
        <p className="text-[14px] text-[#52525b]">
          {busy ? (
            '규격에 맞게 자르는 중'
          ) : dragOver ? (
            '여기에 놓으세요'
          ) : (
            <>
              이미지를 끌어다 놓거나{' '}
              <span className="text-primary font-medium underline underline-offset-2">
                찾아보기
              </span>
            </>
          )}
        </p>
      </div>

      {hasAny && (
        <div className="grid gap-2">
          {rows.map((r) => {
            const src = resolvePublicFileUrl(r.fileId);
            const rowBusy = busyRow === r.key;
            return (
              <div
                key={r.key}
                className="flex items-center gap-3 rounded-lg border border-[#e4e4e7] bg-white p-2"
              >
                <div className="flex h-11 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-[#f4f4f5]">
                  {rowBusy ? (
                    <Loader2 className="text-primary h-4 w-4 animate-spin" />
                  ) : src ? (
                    // file-service 프록시 경유 임의 이미지
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={src}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-[#c6c6ca]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#1f2937]">
                    {r.label}
                  </p>
                  <p className="text-[12px] text-[#a1a1aa]">
                    {src
                      ? r.slot
                        ? `${r.slot.width}×${r.slot.height}`
                        : '규격 미지정'
                      : '비어 있음'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={disabled || busy || rowBusy}
                  onClick={() => r.inputRef.current?.click()}
                  className="text-primary shrink-0 px-2 text-[12px] font-medium hover:underline"
                >
                  {src ? '바꾸기' : '올리기'}
                </button>
                {src && (
                  <button
                    type="button"
                    aria-label={`${r.label} 이미지 제거`}
                    disabled={disabled || busy || rowBusy}
                    onClick={() =>
                      onChange(
                        r.key === 'pc'
                          ? { pcImageFileId: undefined }
                          : { mobileImageFileId: undefined }
                      )
                    }
                    className="text-muted-foreground hover:text-foreground shrink-0 p-1.5"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <input
                  ref={r.inputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void replaceOne(r.key, e.target.files?.[0] ?? undefined);
                    e.target.value = '';
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
      />

      <AlertDialog
        open={!!confirmFile}
        onOpenChange={(open) => {
          if (!open) setConfirmFile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이미지를 새로 올릴까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금 올라가 있는 PC·모바일 이미지가 방금 고른 이미지로 바뀝니다.
              한쪽만 바꾸려면 아래 목록의 「바꾸기」를 쓰세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const f = confirmFile;
                setConfirmFile(null);
                if (f) void applyFile(f);
              }}
            >
              바꾸기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

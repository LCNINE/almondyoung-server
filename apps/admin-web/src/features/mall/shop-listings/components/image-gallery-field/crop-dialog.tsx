'use client';

import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Check, Loader2, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import { cropImageToArea, type CropArea } from '@/lib/utils/image-crop';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
/** 목록 카드·슬라이드가 모두 4:3 이라 같은 비율로 자른다 */
const ASPECT = 4 / 3;

type Props = {
  /** 자를 대상 fileId. null 이면 닫힌 상태 */
  fileId: string | null;
  contextId: string;
  onClose: () => void;
  /** 자른 결과로 새로 올린 fileId */
  onCropped: (newFileId: string) => void;
};

export function CropDialog({ fileId, contextId, onClose, onCropped }: Props) {
  const [source, setSource] = useState<{ url: string; file: File } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);

  // 이미 올라간 이미지라 원본을 다시 받아와야 자를 수 있다.
  // file-service 를 직접 부르면 302(CORS 헤더 없음) + 인증 때문에 막히므로,
  // 어드민 자체 프록시로 받는다 — 같은 출처라 CORS 가 없고 쿠키도 실린다.
  useEffect(() => {
    if (!fileId) {
      setSource(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetchWithRefresh(
          `/api/proxy/file/files/public/${encodeURIComponent(fileId)}`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          throw new Error(`원본을 불러오지 못했습니다. (${res.status})`);
        }
        const blob = await res.blob();
        if (cancelled) return;

        const file = new File([blob], `${fileId}.jpg`, {
          type: blob.type || 'image/jpeg',
        });
        objectUrl = URL.createObjectURL(file);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setArea(null);
        setSource({ url: objectUrl, file });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : '원본을 불러오지 못했습니다.'
        );
        onClose();
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, onClose]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setArea(pixels);
  }, []);

  const apply = async () => {
    if (!source || !area) return;

    setBusy(true);
    try {
      const cropped = await cropImageToArea(source.file, area);
      const { id } = await uploadFileToFileService(cropped, {
        contextId,
        isPublic: true,
      });
      onCropped(id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '자르기에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!fileId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>사진 자르기</DialogTitle>
          <DialogDescription>
            상세 화면 슬라이드는 4:3 으로 보여줍니다. 밝은 영역이 실제로 보이는
            부분이에요 — 드래그해서 위치를 잡고, 아래에서 확대할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative h-[300px] w-full overflow-hidden rounded">
          {source ? (
            <Cropper
              image={source.url}
              crop={crop}
              zoom={zoom}
              aspect={ASPECT}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              // 기본값 contain 은 세로로 긴 사진에서 크롭 박스가 사진 안쪽에
              // 작게 잡혀 대부분을 버린다. cover 라야 1.0x 에서 폭을 꽉 채운다.
              objectFit="cover"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="text-muted-foreground h-4 w-4 shrink-0" />
          <Slider
            value={[zoom]}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            disabled={!source || busy}
            onValueChange={([next]) => setZoom(next)}
          />
          <span className="text-muted-foreground w-10 shrink-0 text-right text-xs">
            {zoom.toFixed(1)}x
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={() => void apply()} disabled={!source || !area || busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            이대로 자르기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useRef, useState } from 'react';
import { ImageUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { useSaveAlmondTemplateCategory } from '@/lib/services/products';
import type { AlmondTemplateCategoryDto } from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { cropImageToArea, loadImage } from '@/lib/utils/image-crop';
import { ALMOND_TEMPLATE_KIND_LABELS } from '../../almond-templates/lib/almond-template-rules';

const IMAGE_CONTEXT_ID = 'almond-template-image';

type Props = {
  open: boolean;
  category: AlmondTemplateCategoryDto | null;
  onClose: () => void;
};

// 랜딩 카드는 정사각형이라 가운데를 정사각형으로 잘라 올린다
async function cropSquare(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const { naturalWidth: width, naturalHeight: height } = await loadImage(url);
    const side = Math.min(width, height);

    return await cropImageToArea(file, {
      x: (width - side) / 2,
      y: (height - side) / 2,
      width: side,
      height: side,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CategoryDialog({ open, category, onClose }: Props) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [kind, setKind] = useState(category?.kind ?? '');
  const [isVisible, setIsVisible] = useState(category?.isVisible ?? true);
  const [imageFileId, setImageFileId] = useState(category?.imageFileId ?? '');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const save = useSaveAlmondTemplateCategory();

  const imageSrc = resolvePublicFileUrl(imageFileId);
  const canSave =
    !!name.trim() && !!kind && !!imageFileId && !uploading && !save.isPending;

  const upload = async (file: File | undefined) => {
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('JPG·PNG·WEBP 이미지만 올릴 수 있어요.');
      return;
    }

    setUploading(true);
    try {
      const res = await uploadFileToFileService(await cropSquare(file), {
        contextId: IMAGE_CONTEXT_ID,
        isPublic: true,
      });
      setImageFileId(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '업로드에 실패했어요.');
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    save.mutate(
      {
        id: category?.id,
        body: {
          name: name.trim(),
          description: description.trim() || null,
          imageFileId,
          kind,
          isVisible,
        },
      },
      {
        onSuccess: () => {
          toast.success(
            category ? '카테고리를 고쳤어요.' : '카테고리를 추가했어요.'
          );
          onClose();
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : '저장하지 못했어요.'),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {category ? '카테고리 수정' : '카테고리 추가'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>카드 이미지</Label>
            <button
              type="button"
              aria-label="카드 이미지 올리기 또는 바꾸기"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex aspect-square w-48 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-[#e4e4e7] bg-[#fafafa]"
            >
              {uploading ? (
                <Loader2 className="text-primary h-6 w-6 animate-spin" />
              ) : imageSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageSrc}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageUp className="h-8 w-8 text-[#c6c6ca]" />
              )}
            </button>
            <p className="text-muted-foreground text-[12px]">
              정사각형으로 가운데를 잘라 올려요. 누르면 바꿀 수 있어요.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-name">이름</Label>
            <Input
              id="category-name"
              value={name}
              maxLength={40}
              placeholder="예: 시술 후 주의사항 카드"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-description">한 줄 설명</Label>
            <Input
              id="category-description"
              value={description}
              maxLength={80}
              placeholder="예: 시술 후 관리법을 한 장으로 안내"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>누르면 보여 줄 상품 종류</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue placeholder="상품 종류 고르기" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ALMOND_TEMPLATE_KIND_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-[14px]">
            <Checkbox
              checked={isVisible}
              onCheckedChange={(checked) => setIsVisible(checked === true)}
            />
            랜딩에 보이기
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {save.isPending ? '저장 중' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUploadField } from '@/components/common/image-upload-field';
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';

/** 리스트 칸 그림 권장 규격 (정사각) */
const LIST_IMAGE_SIZE = 200;

type Value = {
  listImageFileId?: string;
  listLabel?: string;
  isActive?: boolean;
};

/** 노출중으로 저장할 때만 막는다 — 비활성 초안은 비워둬도 된다 */
export function heroListError(value: Value): string | null {
  if (!value.isActive) return null;
  if (!value.listImageFileId) return '리스트 그림을 업로드해 주세요.';
  if (!value.listLabel?.trim()) return '리스트 노출문구를 입력해 주세요.';
  return null;
}

/** 노출중 배너 중 리스트가 채워진 개수. 전부 채워져야 스토어프론트에 리스트가 뜬다 */
export function heroListProgress(
  banners: { isActive: boolean; listImageFileId?: string; listLabel?: string }[]
): { filled: number; total: number } {
  const active = banners.filter((b) => b.isActive);
  return {
    filled: active.filter((b) => b.listImageFileId && b.listLabel).length,
    total: active.length,
  };
}

type Props = {
  idPrefix: string;
  value: Value;
  onChange: (patch: Partial<Value>) => void;
};

export function BannerListFields({ idPrefix, value, onChange }: Props) {
  return (
    <div className="grid gap-4 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">리스트 (배너 오른쪽 한 칸)</p>
        <p className="text-muted-foreground text-xs">
          메인 이미지와 별개입니다. 그룹의 노출 배너 전부에 채워져야 리스트가
          화면에 나타납니다.
        </p>
      </div>

      <ImageUploadField
        label="리스트 그림"
        required
        slotRatio={{ width: LIST_IMAGE_SIZE, height: LIST_IMAGE_SIZE }}
        previewMaxWidth={120}
        description={`권장 ${LIST_IMAGE_SIZE}×${LIST_IMAGE_SIZE} (1:1)`}
        contextId={BANNER_IMAGE_CONTEXT_ID}
        value={value.listImageFileId}
        onChange={(fileId) =>
          onChange({ listImageFileId: fileId ?? undefined })
        }
      />

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-listLabel`}>
          노출문구 <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`${idPrefix}-listLabel`}
          maxLength={100}
          placeholder="환절기 수분충전 티젠 특가"
          value={value.listLabel ?? ''}
          onChange={(e) => onChange({ listLabel: e.target.value || undefined })}
        />
        <p className="text-muted-foreground text-xs">
          고객에게 보이는 문구입니다. 위의 «제목»은 관리용이라 화면에 나오지
          않습니다.
        </p>
      </div>
    </div>
  );
}

'use client';

import { ImageUploadField } from '@/components/common/image-upload-field';
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';

const publicFileBase = (
  process.env.NEXT_PUBLIC_FILE_PUBLIC_URL ?? 'https://file.almondyoung.com'
).replace(/\/+$/, '');

export function TimeSaleImageField({
  value,
  onChange,
  background = false,
}: {
  value: string;
  onChange: (value: string) => void;
  background?: boolean;
}) {
  const image = background
    ? (value.match(/^url\(["']?([^"')]+)["']?\)$/)?.[1] ?? '')
    : value;
  const change = (url: string) =>
    onChange(background && url.startsWith('https://') ? `url(${url})` : url);

  return (
    <div className="ts-image-field">
      <label className="ts-field">
        <span>이미지 주소</span>
        <textarea
          aria-label={background ? '배경 이미지 주소' : '이미지 주소'}
          value={value}
          placeholder="https://…"
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <ImageUploadField
        label="직접 업로드"
        value={image || null}
        contextId={BANNER_IMAGE_CONTEXT_ID}
        previewShape="wide"
        onChange={(id) =>
          change(id ? `${publicFileBase}/files/public/${id}` : '')
        }
        description="이미지를 선택하거나 끌어다 놓으면 업로드 후 주소가 자동 입력됩니다."
      />
    </div>
  );
}

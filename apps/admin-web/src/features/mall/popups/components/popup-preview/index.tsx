'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { sanitizeNoticeHtml } from '@/lib/utils/sanitize-notice-html';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { DEFAULT_MOBILE_WIDTH, DEFAULT_PC_WIDTH, type SitePopupFormValue } from '../../form';

type Device = 'pc' | 'mobile';

/**
 * 저장 전에 실제 노출 크기를 눈으로 확인하기 위한 미리보기.
 * 스토어프론트와 같은 규칙(높이 미지정 → 자동, 이미지 없으면 PC 이미지 폴백)을 따른다.
 */
export function PopupPreview({ value }: { value: SitePopupFormValue }) {
  const [device, setDevice] = useState<Device>('pc');

  const width =
    device === 'pc'
      ? (toSize(value.pcWidth) ?? DEFAULT_PC_WIDTH)
      : (toSize(value.mobileWidth) ?? DEFAULT_MOBILE_WIDTH);
  const height = device === 'pc' ? toSize(value.pcHeight) : toSize(value.mobileHeight);

  const imageFileId =
    device === 'pc'
      ? value.pcImageFileId
      : (value.mobileImageFileId ?? value.pcImageFileId);
  const imageSrc = resolvePublicFileUrl(imageFileId);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Label>미리보기</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={device === 'pc' ? 'default' : 'outline'}
            onClick={() => setDevice('pc')}
          >
            PC
          </Button>
          <Button
            type="button"
            size="sm"
            variant={device === 'mobile' ? 'default' : 'outline'}
            onClick={() => setDevice('mobile')}
          >
            모바일
          </Button>
        </div>
      </div>

      <div className="bg-muted/40 flex justify-center overflow-auto rounded-md border p-4">
        <div
          className="bg-background flex shrink-0 flex-col overflow-hidden rounded-lg border shadow-lg"
          style={{ width, height: height ?? undefined, maxWidth: '100%' }}
        >
          <div className="border-b px-5 py-4">
            <p className="text-base leading-snug font-bold">
              {value.title.trim() || '(제목 없음)'}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {value.contentType === 'image' ? (
              imageSrc ? (
                // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc}
                  alt={value.imageAlt || value.title}
                  className="block w-full"
                  style={height ? { height: '100%', objectFit: 'contain' } : undefined}
                />
              ) : (
                <div className="text-muted-foreground p-6 text-center text-sm">
                  이미지를 업로드하면 여기에 표시됩니다.
                </div>
              )
            ) : (
              <div
                className="prose prose-sm max-w-none px-5 py-4 text-[15px] leading-7"
                dangerouslySetInnerHTML={{ __html: sanitizeNoticeHtml(value.content) }}
              />
            )}
          </div>

          <div className="flex items-center justify-between border-t px-5 py-3">
            <span className="text-muted-foreground text-[13px]">
              {value.dismissMode === 'none'
                ? ''
                : value.dismissMode === 'today'
                  ? '오늘 하루 보지 않기'
                  : `${value.dismissDays || 'N'}일간 보지 않기`}
            </span>
            <div className="flex gap-2">
              {value.noticeId && (
                <Button type="button" size="sm" variant="outline" disabled>
                  자세히 보기
                </Button>
              )}
              <Button type="button" size="sm" disabled>
                닫기
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        지정한 크기: {width}px{height ? ` × ${height}px` : ' × 자동'}
      </p>
    </div>
  );
}

function toSize(raw: string): number | null {
  if (!raw.trim()) return null;
  const size = Number(raw);
  return Number.isNaN(size) ? null : size;
}

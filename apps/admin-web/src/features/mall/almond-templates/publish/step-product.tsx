'use client';

import { ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PrintOptionsDto } from '@/lib/types/dto/print-catalog';

interface StepProductProps {
  thumbnailUrl: string;
  kindLabel: string;
  width: number;
  height: number;
  name: string;
  description: string;
  options: PrintOptionsDto | undefined;
  optionsLoading: boolean;
  optionsError: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRetryOptions: () => void;
}

export function StepProduct({
  thumbnailUrl,
  kindLabel,
  width,
  height,
  name,
  description,
  options,
  optionsLoading,
  optionsError,
  onNameChange,
  onDescriptionChange,
  onRetryOptions,
}: StepProductProps) {
  const bleed = options?.cutsizeHalfMm ?? 0;

  return (
    <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
      <div>
        <div className="bg-muted relative aspect-[9/5] overflow-hidden rounded-lg border">
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <ImageIcon className="h-6 w-6" />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">대표 이미지는 시안 앞면이에요.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-name">
            상품명 <span className="text-muted-foreground text-xs font-normal">템플릿 이름에서 채웠어요</span>
          </Label>
          <Input id="publish-name" value={name} maxLength={255} onChange={(e) => onNameChange(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-description">
            한 줄 설명 <span className="text-muted-foreground text-xs font-normal">수정할 수 있어요</span>
          </Label>
          <Textarea
            id="publish-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>

        <div className="bg-muted/50 rounded-lg px-3.5 py-3 text-sm leading-7">
          <div>
            <span className="text-muted-foreground inline-block w-24">인쇄 종류</span>
            {kindLabel} · {width}×{height}mm
          </div>
          <div>
            <span className="text-muted-foreground inline-block w-24">인쇄소 제품</span>
            {optionsLoading ? '불러오는 중…' : options ? `와우프레스 ${options.prodname}` : '-'}
          </div>
          {options && (
            <div>
              <span className="text-muted-foreground inline-block w-24">파일</span>
              재단 여유 {bleed}mm (작업 {width + bleed * 2}×{height + bleed * 2}mm)
            </div>
          )}
        </div>

        {optionsError && (
          <div className="text-destructive flex items-center gap-2 text-sm">
            와우프레스 옵션을 불러오지 못했어요.
            <button type="button" className="underline" onClick={onRetryOptions}>
              다시 시도
            </button>
          </div>
        )}
        {options && !options.bleedMatches && (
          <p className="text-destructive text-sm">
            편집기 재단 여유가 와우프레스 작업 크기와 달라서 게시할 수 없어요.
          </p>
        )}
      </div>
    </div>
  );
}

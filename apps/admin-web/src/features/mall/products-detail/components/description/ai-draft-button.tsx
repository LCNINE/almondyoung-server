'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import {
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';

/** 서버(route.ts)의 MAX_IMAGES 와 같은 값. 바꿀 땐 양쪽 다 고칠 것. */
export const MAX_AI_DRAFT_IMAGES = 30;

type Props = {
  disabled?: boolean;
  productName?: string;
  /** 고른 양식 ID. 없으면 서버의 기본 프롬프트를 쓴다. */
  presetId?: string;
  onGenerated: (markdown: string) => void;
};

export function AiDraftButton({
  disabled,
  productName,
  presetId,
  onGenerated,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'generating'>('idle');

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    // 업로드 전에 막는다 — 초과분까지 S3 에 올린 뒤 서버에서 400 을 받으면 시간·용량 낭비.
    if (files.length > MAX_AI_DRAFT_IMAGES) {
      toast.error(
        `이미지는 한 번에 최대 ${MAX_AI_DRAFT_IMAGES}장까지 선택할 수 있습니다.`,
        { description: `${files.length}장을 고르셨습니다. 나눠서 생성해주세요.` }
      );
      return;
    }

    // 생성이 1분 가까이 걸려 버튼 라벨만으로는 멈춘 건지 도는 건지 알 수 없다.
    // 경과 초를 갱신하는 로딩 토스트로 진행 중임을 계속 보여준다.
    const toastId = 'ai-product-description';
    let elapsed = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;

    setPhase('uploading');
    toast.loading(`이미지 ${files.length}장 업로드 중...`, { id: toastId });

    try {
      const uploads = await Promise.all(
        files.map((file) =>
          uploadFileToFileService(file, {
            contextId: PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
            isPublic: true,
          })
        )
      );

      setPhase('generating');
      toast.loading('AI 가 상세페이지를 작성 중입니다...', {
        id: toastId,
        description: '이미지 장수에 따라 1분 이상 걸릴 수 있습니다.',
      });
      ticker = setInterval(() => {
        elapsed += 1;
        toast.loading('AI 가 상세페이지를 작성 중입니다...', {
          id: toastId,
          description: `${elapsed}초 경과 · 이미지 장수에 따라 1분 이상 걸릴 수 있습니다.`,
        });
      }, 1000);

      const res = await fetchWithRefresh('/api/ai/product-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fileIds: uploads.map((upload) => upload.id),
          productName,
          presetId,
        }),
      });

      const json = (await res.json()) as {
        markdown?: string;
        truncated?: boolean;
        message?: string;
      };
      if (!res.ok || !json.markdown) {
        throw new Error(json.message ?? `AI 초안 생성에 실패했습니다. (status: ${res.status})`);
      }

      onGenerated(json.markdown);
      toast.success(`AI 초안을 넣었습니다. (${elapsed}초)`, {
        id: toastId,
        description: json.truncated
          ? '길이 제한으로 뒷부분이 잘렸을 수 있습니다. 내용을 확인해주세요.'
          : '내용과 이미지 배치를 확인하고 다듬어주세요.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI 초안 생성에 실패했습니다.', {
        id: toastId,
      });
    } finally {
      if (ticker) clearInterval(ticker);
      setPhase('idle');
    }
  };

  const label =
    phase === 'uploading'
      ? '이미지 업로드 중...'
      : phase === 'generating'
        ? 'AI 작성 중...'
        : '이미지로 상세페이지 생성';

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={disabled || phase !== 'idle'}
        onClick={() => inputRef.current?.click()}
      >
        <Sparkles data-icon="inline-start" />
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        onChange={onFileChange}
      />
    </>
  );
}

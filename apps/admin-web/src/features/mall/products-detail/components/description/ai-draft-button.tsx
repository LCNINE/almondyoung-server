'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { generateAiDraft } from './generate-ai-draft';
import { shrinkImageForAi } from './shrink-image';

/**
 * 이미지는 8장씩 나눠 분석하므로 API 제약상 더 올려도 되지만, 장수만큼 호출과 비용이
 * 늘어난다. 상세페이지 한 장에 30장을 넘길 일이 없어 여기서 끊는다.
 */
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
  const [phase, setPhase] = useState<
    'idle' | 'uploading' | 'analyzing' | 'writing'
  >('idle');

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    // 업로드 전에 막는다 — 초과분까지 S3 에 올린 뒤 서버에서 400 을 받으면 시간·용량 낭비.
    if (files.length > MAX_AI_DRAFT_IMAGES) {
      toast.error(
        `이미지는 한 번에 최대 ${MAX_AI_DRAFT_IMAGES}장까지 선택할 수 있습니다.`,
        {
          description: `${files.length}장을 고르셨습니다. 나눠서 생성해주세요.`,
        }
      );
      return;
    }

    // 생성이 1분 가까이 걸려 버튼 라벨만으로는 멈춘 건지 도는 건지 알 수 없다.
    // 경과 초와 현재 단계를 갱신하는 로딩 토스트로 진행 중임을 계속 보여준다.
    const toastId = 'ai-product-description';
    let elapsed = 0;
    let heading = `이미지 ${files.length}장 업로드 중...`;
    let ticker: ReturnType<typeof setInterval> | undefined;

    const render = () =>
      toast.loading(heading, {
        id: toastId,
        description: elapsed > 0 ? `${elapsed}초 경과` : undefined,
      });

    setPhase('uploading');
    render();

    try {
      // Claude 는 8000px 를 넘는 이미지를 거부한다. 상세 이미지는 세로로 길어 흔히
      // 넘으므로 업로드 전에 줄인다 (자세한 배경은 shrink-image.ts).
      const uploads = await Promise.all(
        files.map(async (file) =>
          uploadFileToFileService(await shrinkImageForAi(file), {
            contextId: PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
            isPublic: true,
          })
        )
      );

      ticker = setInterval(() => {
        elapsed += 1;
        render();
      }, 1000);

      const { markdown, truncated } = await generateAiDraft({
        fileIds: uploads.map((upload) => upload.id),
        productName,
        presetId,
        onProgress: (progress) => {
          if (progress.phase === 'extracting') {
            setPhase('analyzing');
            heading = `이미지 분석 중... (${progress.done}/${progress.total})`;
          } else {
            setPhase('writing');
            heading = 'AI 가 상세페이지를 작성 중입니다...';
          }
          render();
        },
      });

      onGenerated(markdown);
      toast.success(`AI 초안을 넣었습니다. (${elapsed}초)`, {
        id: toastId,
        description: truncated
          ? '길이 제한으로 뒷부분이 잘렸을 수 있습니다. 내용을 확인해주세요.'
          : '내용과 이미지 배치를 확인하고 다듬어주세요.',
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'AI 초안 생성에 실패했습니다.',
        {
          id: toastId,
        }
      );
    } finally {
      if (ticker) clearInterval(ticker);
      setPhase('idle');
    }
  };

  const label =
    phase === 'uploading'
      ? '이미지 업로드 중...'
      : phase === 'analyzing'
        ? '이미지 분석 중...'
        : phase === 'writing'
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

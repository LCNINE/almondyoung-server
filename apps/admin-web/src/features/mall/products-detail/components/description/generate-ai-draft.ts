import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import {
  type ExtractResult,
  IMAGES_PER_CHUNK,
  chunkFileIds,
  mergeExtractResults,
} from './ai-draft';

export type DraftProgress =
  | { phase: 'extracting'; done: number; total: number }
  | { phase: 'composing' };

async function postJson<T>(
  url: string,
  body: unknown,
  fallback: string
): Promise<T> {
  const res = await fetchWithRefresh(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) {
    throw new Error(json.message ?? `${fallback} (status: ${res.status})`);
  }
  return json;
}

/**
 * 이미지를 청크로 나눠 병렬 분석한 뒤, 그 결과를 합쳐 한 번에 상세페이지를 쓴다.
 * 한 호출에 다 시키면 60초 CloudFront 타임아웃에 걸린다 — ai-draft.ts 참조.
 */
export async function generateAiDraft(params: {
  fileIds: string[];
  productName?: string;
  presetId?: string;
  onProgress?: (progress: DraftProgress) => void;
}): Promise<{ markdown: string; truncated: boolean }> {
  const { fileIds, productName, presetId, onProgress } = params;
  const chunks = chunkFileIds(fileIds, IMAGES_PER_CHUNK);

  let done = 0;
  onProgress?.({ phase: 'extracting', done, total: chunks.length });

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const json = await postJson<{ result: ExtractResult }>(
        '/api/ai/product-description/extract',
        { fileIds: chunk },
        '이미지 분석에 실패했습니다.'
      );
      done += 1;
      onProgress?.({ phase: 'extracting', done, total: chunks.length });
      return json.result;
    })
  );

  onProgress?.({ phase: 'composing' });

  const composed = await postJson<{ markdown?: string; truncated?: boolean }>(
    '/api/ai/product-description/compose',
    { result: mergeExtractResults(results), productName, presetId },
    'AI 초안 생성에 실패했습니다.'
  );

  if (!composed.markdown) {
    throw new Error('AI 초안 생성에 실패했습니다.');
  }

  return {
    markdown: composed.markdown,
    truncated: composed.truncated ?? false,
  };
}

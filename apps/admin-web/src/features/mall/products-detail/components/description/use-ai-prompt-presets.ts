'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiPromptsClient } from '@/lib/api/domains/products/ai-prompts.client';

export const AI_PROMPT_PRESETS_KEY = ['ai-prompt-presets', 'product-description'];

/** 셀렉트에서 고른 양식 ID 를 브라우저에 기억해 다음 상품에서도 같은 양식이 잡히게 한다. */
export const SELECTED_PRESET_STORAGE_KEY = 'ai-prompt-preset:product-description';

export function useAiPromptPresets(enabled: boolean) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: AI_PROMPT_PRESETS_KEY,
    queryFn: () => aiPromptsClient.list(),
    enabled,
    staleTime: 60_000,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: AI_PROMPT_PRESETS_KEY });

  return { presets: query.data ?? [], isLoading: query.isLoading, refresh };
}

import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

/**
 * GET /inventory/skus?barcode=…
 * search/advanced 는 name·code 만 보고 바코드를 안 본다 — 스캔 경로는 이 엔드포인트뿐이다.
 * 응답은 배열({items,total} 아님).
 *
 * 스캔은 "상태"가 아니라 "이벤트"다: useQuery(캐시 기반)로 감싸면 staleTime·재활성화
 * 시점에 따라 "이미 처리했다"는 판정이 실제 스캔 횟수와 어긋난다(재조회를 캐시가
 * 가로막아 응답이 누락되거나, 반대로 낡은 응답이 재활성화 시점에 다시 성공으로
 * 관측돼 중복 처리될 수 있다 — 둘 다 실제로 확인됨). useMutation 은 스캔마다
 * 독립된 요청을 만들고, 그 결과는 그 mutate 호출의 onSuccess 콜백에서만 정확히
 * 한 번 소비된다 — 캐시 신선도와 무관하다.
 */
export function useSkuByBarcode() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (barcode: string) =>
      api.request<SkuSearchItem[]>({
        path: `/inventory/skus?barcode=${encodeURIComponent(barcode)}`,
      }),
  });
}

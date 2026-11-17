import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { loadFailed } from '../../core/data/loadFailed';
import {
  fetchMyReturnBin,
  type ReturnBinItem,
} from '../../domains/returns/returnBinApi';

const MY_RETURN_BIN_KEY = 'my-return-bin';

export type ReturnBinView =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: ReturnBinItem[] };

/**
 * 빠진 상자 화면에서 볼 내 되돌림 바구니. 화면을 열 때마다(screen) 새로 읽는다 — 앞 상자 때 읽은 결과로
 * 비었다/찼다를 판단하면 F4 가 엉뚱한 곳으로 간다
 */
export function useMyReturnBin(
  warehouseId: string,
  screen: number | null
): ReturnBinView {
  const api = useApiClient();
  const query = useQuery({
    queryKey: [MY_RETURN_BIN_KEY, warehouseId, screen],
    queryFn: () => fetchMyReturnBin(api, warehouseId),
    enabled: screen !== null,
    gcTime: 0,
  });
  if (loadFailed(query)) return { kind: 'failed' };
  return query.data
    ? { kind: 'ready', items: query.data.items }
    : { kind: 'loading' };
}

/** 바구니에 든 것이 있거나 확인하지 못했으면 되돌림 적치로 이어 간다 */
export function needsReturnPutaway(bin: ReturnBinView): boolean {
  return (
    bin.kind === 'failed' || (bin.kind === 'ready' && bin.items.length > 0)
  );
}

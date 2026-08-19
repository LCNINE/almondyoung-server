// src/features/mall/channel-listings/components/channel-listing-form-dialog/resolve-channel-id.ts
//
// 격리 큐가 아는 것은 채널 코드(`site`, 예: 'naver')뿐이고, 리스팅 생성 폼이 실제로 저장하는
// 것은 판매채널 UUID(`salesChannelId`)다. `useActiveChannels()`(products 도메인, `/channels/active`)
// 가 이미 두 값을 다 가진 `ChannelDto[]` 를 돌려주므로 그걸로 코드→UUID를 해석한다.
//
// 실패 갈래를 "로딩 중"과 "찾지 못함"으로 나누는 이유: 후자는 그 자체로 운영 신호다 —
// 격리 사유 어휘(`ListingResolutionCause`)에 `channel_inactive` 가 있는 것과 같은 결이다.
// 채널이 비활성이거나 아예 없는 상태를 조용히 빈 칸으로 넘기면 운영자가 "왜 안 채워지지"를
// 스스로 조사해야 한다.

import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
import type { ChannelDto } from '@/lib/types/dto/products';

export type ChannelResolution =
  | { status: 'resolved'; salesChannelId: string }
  | { status: 'loading' }
  | { status: 'unresolved' };

/**
 * `code`(채널 사이트 코드)를 활성 판매채널 목록에서 찾아 UUID로 해석한다.
 * `code` 가 없으면(격리 큐가 아닌 일반 검색 플로우) 애초에 해석할 것이 없으므로 `unresolved`.
 */
export function resolveActiveChannelId(
  code: string | undefined,
  channels: ChannelDto[] | undefined,
  isLoadingChannels: boolean
): ChannelResolution {
  if (!code) return { status: 'unresolved' };
  if (isLoadingChannels) return { status: 'loading' };

  const match = (channels ?? []).find((c) => c.site === code && c.isActive);
  return match
    ? { status: 'resolved', salesChannelId: match.id }
    : { status: 'unresolved' };
}

/**
 * 판매채널 ID 입력칸 위에 보여줄 안내 문구. `code` 가 없으면(일반 검색 플로우) 아무 말도
 * 하지 않는다 — 이 문구는 격리 큐에서 열렸을 때만 의미가 있다.
 */
export function channelResolutionMessage(
  resolution: ChannelResolution,
  code: string | undefined
): string | null {
  if (!code) return null;

  switch (resolution.status) {
    case 'resolved':
      return `채널: ${siteLabel(code)} (${code}) — 자동으로 채워졌습니다.`;
    case 'loading':
      return '채널 목록을 불러오는 중입니다…';
    case 'unresolved':
      return `활성 상태인 '${siteLabel(code)}(${code})' 채널을 찾지 못했습니다 — 채널이 비활성이거나 아직 등록되지 않았을 수 있습니다. 직접 UUID를 입력하세요.`;
  }
}

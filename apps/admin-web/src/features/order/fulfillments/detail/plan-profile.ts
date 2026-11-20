import type { ShipmentAdminLine } from '@/lib/types/dto/fulfillment';

export type LineProfile = { id: string; name: string } | null;

/** 프로필별로 묶고 나누는 데 필요한 줄 — 상자 상세 줄과 출고 준비 응답의 나누기 줄이 둘 다 맞는다 */
export type ProfileLine = Pick<
  ShipmentAdminLine,
  | 'id'
  | 'skuId'
  | 'skuName'
  | 'skuCode'
  | 'qty'
  | 'lineVersion'
  | 'deliveryProfile'
>;

/** 같은 배송 프로필 상품끼리 모은 줄. 프로필이 없는 상품도 한 묶음이다. */
export interface ProfileGroup {
  key: string;
  profile: LineProfile;
  lines: ProfileLine[];
  qty: number;
}

/**
 * 상자 확정이 받을 배송 프로필. 담긴 SKU 가 모두 같은 프로필일 때만 확정할 수 있다.
 * 줄에 프로필이 실리지 않은 응답이면 `unknown` — 판단하지 않고 예전처럼 고르게 둔다.
 */
export type PlanProfileState =
  | { kind: 'unknown' }
  | { kind: 'single'; profile: { id: string; name: string } }
  | { kind: 'blocked'; groups: ProfileGroup[] };

// 고르기 칸의 값은 빈 문자열일 수 없다
const NO_PROFILE = 'no-profile';

export function profileGroups(lines: ProfileLine[]): ProfileGroup[] | null {
  if (
    lines.length === 0 ||
    lines.some((line) => line.deliveryProfile === undefined)
  ) {
    return null;
  }

  const groups = new Map<string, ProfileGroup>();

  for (const line of lines) {
    const profile = line.deliveryProfile ?? null;
    const key = profile?.id ?? NO_PROFILE;
    const group = groups.get(key) ?? { key, profile, lines: [], qty: 0 };

    group.lines.push(line);
    group.qty += line.qty;
    groups.set(key, group);
  }

  return [...groups.values()];
}

export function planProfileState(lines: ProfileLine[]): PlanProfileState {
  const groups = profileGroups(lines);

  if (!groups) {
    return { kind: 'unknown' };
  }

  const [only] = groups;

  if (groups.length === 1 && only.profile) {
    return { kind: 'single', profile: only.profile };
  }

  return { kind: 'blocked', groups };
}

export function profileGroupName(group: ProfileGroup): string {
  return group.profile ? `«${group.profile.name}»` : '배송 프로필 없음';
}

/**
 * 프로필별로 나눌 때 새 상자로 보낼 묶음의 기본값 — 첫 줄이 있는 묶음은 이 상자에 남기고 그다음 묶음을 보낸다.
 * 프로필이 없는 묶음은 나눠도 확정할 수 없으므로 고를 수 있는 묶음이 있으면 그쪽을 먼저 고른다.
 */
export function defaultSplitGroupKey(groups: ProfileGroup[]): string {
  const movable = groups.slice(1);

  return (movable.find((group) => group.profile) ?? movable[0])?.key ?? '';
}

/** 묶음의 모든 상품을 전량 새 상자로 */
export function profileSplitMoves(group: ProfileGroup) {
  return group.lines.map((line) => ({
    shipmentLineId: line.id,
    expectedLineVersion: line.lineVersion,
    qty: line.qty,
  }));
}

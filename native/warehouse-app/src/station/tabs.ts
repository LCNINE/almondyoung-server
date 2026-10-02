import type { TabKey } from './keys';

/** 탭이 그리는 경로. 리터럴 유니온이라 앱 라우트에 없는 경로를 적으면 <Link> 에서 타입 에러가 난다. */
export type StationPath =
  | '/outbound'
  | '/outbound/batches'
  | '/inbound'
  | '/putaway'
  | '/returns/putaway'
  | '/movement'
  | '/stocktaking'
  | '/inventory';

export interface StationSection {
  label: string;
  to: StationPath;
}

export interface StationTab {
  key: TabKey;
  label: string;
  to: StationPath;
  /** 이 탭에 속하는 경로 접두어 */
  owns: readonly string[];
  /** 탭 안 화면끼리 오갈 길이 화면에 없을 때만 둔다(U2 — 같은 길을 두 곳에 두지 않는다) */
  sections: readonly StationSection[];
}

/**
 * 스테이션 탭(스펙 §4). 새 탭 화면이 생기기 전(PR C~G)에는 지금 화면을 그 탭 안에 그대로 그린다.
 * - F2 는 PR C 전까지 출고 화면(배치 카드가 거기 있다)을 같이 그린다
 * - F3 은 입고 화면이 간편입고·입고내역 링크를 이미 가져 하위 탭이 없다
 * - F4 는 적치 화면에서 이동·되돌림 적치로 갈 길이 없어 하위 탭을 둔다
 */
export const STATION_TABS: readonly StationTab[] = [
  { key: 'F1', label: '출고 검수', to: '/outbound', owns: ['/outbound'], sections: [] },
  { key: 'F2', label: '배치 현황', to: '/outbound/batches', owns: ['/outbound/batches'], sections: [] },
  { key: 'F3', label: '입고', to: '/inbound', owns: ['/inbound'], sections: [] },
  {
    key: 'F4',
    label: '적치·이동',
    to: '/putaway',
    owns: ['/putaway', '/returns/putaway', '/movement'],
    sections: [
      { label: '적치', to: '/putaway' },
      { label: '되돌림 적치', to: '/returns/putaway' },
      { label: '이동', to: '/movement' },
    ],
  },
  { key: 'F5', label: '실사', to: '/stocktaking', owns: ['/stocktaking'], sections: [] },
  { key: 'F6', label: '재고 조회', to: '/inventory', owns: ['/inventory'], sections: [] },
];

const within = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** 경로가 속한 탭 — 가장 긴 접두어가 이긴다(`/outbound/batches` 는 F2, `/outbound/simple/…` 는 F1). 설정·진단은 null. */
export function activeTabOf(pathname: string): StationTab | null {
  let best: { tab: StationTab; length: number } | null = null;
  for (const tab of STATION_TABS)
    for (const prefix of tab.owns)
      if (within(pathname, prefix) && (best === null || prefix.length > best.length)) best = { tab, length: prefix.length };
  return best?.tab ?? null;
}

export function activeSectionOf(tab: StationTab, pathname: string): StationSection | null {
  let best: StationSection | null = null;
  for (const section of tab.sections)
    if (within(pathname, section.to) && (best === null || section.to.length > best.to.length)) best = section;
  return best;
}

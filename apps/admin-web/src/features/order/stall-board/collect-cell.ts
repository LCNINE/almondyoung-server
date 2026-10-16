// 정체 보드 0단계 «수집» 칸 (#1016 45번 스펙 §8.1). 수집 격리 요약과 «채널과 어긋남» 요약을 합친다.
// 어느 한쪽이라도 못 읽으면 칸 숫자는 «알 수 없음»(null) — 아는 쪽만 보이면 적게 세어 «정상»으로 읽힌다.
// React·react-query 를 import 하지 않는다(admin-web 은 컴포넌트 테스트가 불가능하다).

import type { BandCell } from './components/stage-band';
import type { QuarantineSummary } from '@/lib/api/domains/channel/order-collection-failures.shape';
import type { ReconcileSummary } from '@/lib/api/domains/channel/order-reconcile-findings.shape';

export const MISMATCH_LIST_PATH = '/order/channel-mismatches';
const QUARANTINE_LIST_PATH = '/mall/channel-listings';

/** 요약 하나를 읽은 결과. 못 읽었으면 값이 없다 */
export type Known<T> = { ok: true; data: T } | { ok: false };

export function known<T>(query: {
  isSuccess: boolean;
  data: T | undefined;
}): Known<T> {
  return query.isSuccess && query.data !== undefined
    ? { ok: true, data: query.data }
    : { ok: false };
}

export interface CollectLink {
  href: string;
  label: string;
  /** 못 읽었으면 null — 0 인지 모르므로 링크는 남긴다 */
  count: number | null;
}

function earliest(...isos: (string | null)[]): string | null {
  let best: { iso: string; t: number } | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) continue;
    if (!best || t < best.t) best = { iso, t };
  }
  return best?.iso ?? null;
}

export function collectCell(
  quarantine: Known<QuarantineSummary>,
  mismatch: Known<ReconcileSummary>
): { cell: BandCell; links: CollectLink[] } {
  const quarantined = quarantine.ok ? quarantine.data.quarantined : null;
  const mismatchOpen = mismatch.ok ? mismatch.data.open : null;
  const links: CollectLink[] = [
    { href: QUARANTINE_LIST_PATH, label: '수집 격리', count: quarantined },
    { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: mismatchOpen },
  ];
  return {
    cell: {
      key: 'collect',
      open:
        quarantined !== null && mismatchOpen !== null
          ? quarantined + mismatchOpen
          : null,
      // 격리는 전부 사람 일(정체 보드 스펙 §6)
      stuck: (quarantined ?? 0) + (mismatch.ok ? mismatch.data.human : 0),
      gaveUp: mismatch.ok ? mismatch.data.gaveUp : 0,
      oldestAt: earliest(
        quarantine.ok ? quarantine.data.oldestCreatedAt : null,
        mismatch.ok ? mismatch.data.oldestFirstSeenAt : null
      ),
    },
    links: links.filter((link) => link.count !== 0),
  };
}

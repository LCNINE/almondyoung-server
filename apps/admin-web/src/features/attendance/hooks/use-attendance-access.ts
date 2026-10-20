'use client';

import type { CanState } from '@/lib/auth/permission-check';
import { canAny } from '@/lib/auth/screen-access';
import { useMyPermissions } from '@/lib/services/users';

const granted = (state: CanState) => state.status === 'ready' && state.allowed;

/**
 * 근태 관리 기능을 쓸 수 있는가 — 기능마다 권한으로 판정한다.
 * 확인 전·조회 실패는 «없음»으로 보지 않고 숨긴 채 기다린다(권한 정보 배너가 이유를 알린다).
 * 재조회가 실패하면 이전 사본이 있어도 «확인 못 함»이다 — 관리 화면은 확인된 권한으로만 연다.
 */
export function useAttendanceAccess() {
  const query = useMyPermissions();
  const state = (permission: string): CanState => {
    if (query.isError) return { status: 'error' };
    if (!query.data) return { status: 'loading' };

    return {
      status: 'ready',
      allowed: canAny(query.data.permissions, [permission]),
    };
  };
  const review = state('attendance.request.review');
  const statistics = state('attendance.statistics.read');
  const worksites = state('attendance.worksite.write');
  const staff = state('attendance.staff.read');

  return {
    canReview: granted(review),
    reviewState: review,
    canSeeStatistics: granted(statistics),
    statisticsState: statistics,
    canManageWorksites: granted(worksites),
    worksitesState: worksites,
    canReadStaff: granted(staff),
  };
}

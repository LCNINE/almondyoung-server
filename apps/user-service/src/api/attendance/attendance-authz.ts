/**
 * 옛 판정: 근태 관리(남의 기록·신청 검토·근무지)는 master 역할. 판정 지점 비교의 «옛 결과»로만 쓰고,
 * 옛 가드를 걷을 때 함께 지운다. 새 판정은 `attendance.*` 권한이다(ADR-0048).
 */
export function legacyAttendanceManager(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).includes('master');
}

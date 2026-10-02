/**
 * 관리자 화면이 보내는 'YYYY-MM-DD' 는 한국 날짜다. `new Date('YYYY-MM-DD')` 는 UTC 자정이라
 * 시작이 9시간 어긋나고, 끝을 `lte` 로 걸면 그날 하루가 통째로 빠진다.
 */
export function kstDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}

/** 끝날 «다음 날» 0시(KST). `lt` 로 건다. */
export function kstNextDayStart(date: string): Date {
  return new Date(kstDayStart(date).getTime() + 86_400_000);
}

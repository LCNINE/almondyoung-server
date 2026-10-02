import { formatMonthDay, formatWon } from './format';
import type { Pacing } from './pacing';

export interface PaceCopy {
  tone: 'ahead' | 'behind' | 'done';
  /** 한 줄 결론 */
  headline: string;
  /** 무엇과 무엇을 비교했는지 */
  detail: string;
  /** 그래서 앞으로 하루에 얼마 */
  action: string | null;
}

/**
 * 목표 페이스 문구. «진척 93.3%» 같은 비율만 던지지 않고, 언제까지 얼마를 팔았어야 했는데 실제로 얼마를 팔았고
 * 그래서 남은 날 하루에 얼마씩 팔아야 하는지를 문장으로 쓴다. 금액은 모두 «원»으로 끝나 조사는 «을»로 고정된다.
 */
export function paceCopy(pacing: Pacing, monthlyTargets: number[]): PaceCopy {
  const won = formatWon;
  const asOf = formatMonthDay(pacing.asOf);
  const ratio = pacing.paceRatio != null ? `계획의 ${Math.round(pacing.paceRatio * 100)}%` : null;
  const equalMonths = monthlyTargets.length === 12 && monthlyTargets.every((m) => m === monthlyTargets[0]);
  const plan = equalMonths ? `매달 ${won(monthlyTargets[0])}씩` : '월별 목표대로';

  if (pacing.exceeded) {
    return {
      tone: 'done',
      headline: `올해 목표 ${won(pacing.annualTarget)}을 이미 넘었어요`,
      detail: `${asOf}까지 ${won(pacing.actualToDate)}을 팔아 목표보다 ${won(pacing.actualToDate - pacing.annualTarget)} 더 팔았습니다.`,
      action: null,
    };
  }

  const behind = pacing.paceGap < 0;
  const gap = won(Math.abs(pacing.paceGap));
  const headline = behind ? `목표 일정보다 ${gap} 늦어요` : `목표 일정보다 ${gap} 앞서 있어요`;
  const actualPart = `실제로는 ${won(pacing.actualToDate)}${ratio ? `(${ratio})` : ''}을 팔았습니다`;
  const detail = pacing.missingPreCoverage
    ? `집계 첫날 ${formatMonthDay(pacing.planStart)}부터 ${asOf}까지 계획대로라면 ${won(pacing.planToDate)}을 팔았어야 하는데, ${actualPart}.`
    : `연 ${won(pacing.annualTarget)}을 ${plan} 채우려면 ${asOf}까지 ${won(pacing.planToDate)}을 팔았어야 하는데, ${actualPart}.`;

  const current = `최근 ${pacing.runRateDaysUsed}일 하루 평균은 ${won(pacing.currentDaily)}`;
  const action =
    pacing.remainingDays <= 0
      ? null
      : pacing.requiredDaily <= pacing.currentDaily
        ? `남은 ${pacing.remainingDays}일 동안 하루 ${won(pacing.requiredDaily)}씩만 팔아도 연말에 목표를 채웁니다. ${current}이라 지금 속도면 충분합니다.`
        : `남은 ${pacing.remainingDays}일 동안 하루 ${won(pacing.requiredDaily)}씩 팔아야 연말에 목표를 채웁니다. ${current}입니다.`;

  return { tone: behind ? 'behind' : 'ahead', headline, detail, action };
}

import type { SettlementResult } from '@packages/domain-types/attendance-wage';
import { formatMinutes, ISSUE_LABELS } from './wage-format';

/** 사람이 보는 정산표 한 줄. 식별 번호·계좌 같은 열은 넣지 않는다. */
export function settlementSheetRows(result: SettlementResult) {
  return result.people.map((person) => {
    const sum = (pick: (day: (typeof person.days)[number]) => number) =>
      person.days.reduce((total, day) => total + pick(day), 0);
    const wages = [
      ...new Set(
        person.days.flatMap((day) =>
          day.hourlyWage === null ? [] : [day.hourlyWage]
        )
      ),
    ];
    const issues = result.issues
      .filter((issue) => issue.userId === person.userId)
      .map((issue) =>
        issue.workDate
          ? `${issue.workDate} ${ISSUE_LABELS[issue.kind]}`
          : ISSUE_LABELS[issue.kind]
      );

    return {
      이름: person.name,
      '정산 기간': `${result.periodStart} ~ ${result.periodEnd}`,
      근무시간: formatMinutes(sum((day) => day.workedMinutes)),
      '인정 연장': formatMinutes(
        sum((day) => day.overtimeRecognizedMinutes ?? 0)
      ),
      야간: formatMinutes(sum((day) => day.nightMinutes)),
      주휴: formatMinutes(person.weeklyHolidayMinutes),
      시급: wages.map((wage) => wage.toLocaleString('ko-KR')).join(' → '),
      기본급: person.amounts?.regular ?? '',
      연장수당: person.amounts?.overtime ?? '',
      야간수당: person.amounts?.night ?? '',
      주휴수당: person.amounts?.weeklyHoliday ?? '',
      '유급 부재': person.amounts?.paidLeave ?? '',
      '세전 지급액': person.amounts?.total ?? '',
      '계산 못 함': issues.join(', '),
    };
  });
}

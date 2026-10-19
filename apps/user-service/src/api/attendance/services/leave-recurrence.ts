import { BadRequestException } from '@nestjs/common';
import { isWorkDate, type LeaveInput, type LeaveRecurrence } from '@packages/domain-types/attendance';

export function expandLeaveRecurrence(items: LeaveInput[], recurrence?: LeaveRecurrence): LeaveInput[] {
  if (!recurrence) {
    return items;
  }

  if (!['none', 'weekly', 'monthly', 'yearly'].includes(recurrence.frequency)) {
    throw new BadRequestException('반복 주기를 확인해 주세요.');
  }

  if (recurrence.frequency === 'none') {
    return items;
  }

  if (items.some((item) => !isWorkDate(item.date))) {
    throw new BadRequestException('휴가 날짜를 확인해 주세요.');
  }

  const days = [...items].sort((left, right) => left.date.localeCompare(right.date));
  const first = days[0];

  if (!first || !recurrence.until || !isWorkDate(recurrence.until) || recurrence.until < first.date) {
    throw new BadRequestException('반복 종료일은 시작일 이후의 날짜로 선택해 주세요.');
  }

  const start = new Date(`${first.date}T00:00:00Z`);
  const until = new Date(`${recurrence.until}T00:00:00Z`).getTime();
  const maximumUntil = new Date(start);

  maximumUntil.setUTCFullYear(start.getUTCFullYear() + 10);

  if (until > maximumUntil.getTime()) {
    throw new BadRequestException('반복 종료일은 시작일로부터 10년 안으로 선택해 주세요.');
  }

  const result: LeaveInput[] = [];
  const periodLength = new Date(`${days[days.length - 1].date}T00:00:00Z`).getTime() - start.getTime();
  let previousPeriodEnd = -Infinity;

  for (let occurrence = 0; ; occurrence++) {
    const current = new Date(start);

    if (recurrence.frequency === 'weekly') {
      current.setUTCDate(start.getUTCDate() + occurrence * 7);
    } else if (recurrence.frequency === 'monthly') {
      current.setUTCMonth(start.getUTCMonth() + occurrence);
    } else {
      current.setUTCFullYear(start.getUTCFullYear() + occurrence);
    }

    if (current.getTime() > until) {
      break;
    }

    // Missing dates (the 31st or February 29th) do not move the recurrence anchor.
    if (recurrence.frequency !== 'weekly' && current.getUTCDate() !== start.getUTCDate()) {
      continue;
    }

    if (current.getTime() <= previousPeriodEnd) {
      throw new BadRequestException('반복되는 휴가 기간이 서로 겹치지 않게 선택해 주세요.');
    }

    for (const item of days) {
      const offset = new Date(`${item.date}T00:00:00Z`).getTime() - start.getTime();
      const date = new Date(current.getTime() + offset).toISOString().slice(0, 10);

      if (!isWorkDate(date) || result.length >= 366) {
        throw new BadRequestException('반복을 포함해 휴가 날짜를 최대 366개까지 등록할 수 있어요.');
      }

      result.push({ ...item, date });
    }

    previousPeriodEnd = current.getTime() + periodLength;
  }

  return result;
}

import { BadRequestException } from '@nestjs/common';
import { toUpsertRuleInput } from '../reward-rule.mapper';
import { UpsertRewardRuleDto } from '../dto/reward-rule.dto';

function dto(overrides: Partial<UpsertRewardRuleDto> = {}): UpsertRewardRuleDto {
  return {
    name: '포토리뷰 100원',
    description: null,
    trigger: 'ON_REVIEW_CREATED',
    active: false,
    priority: 0,
    stopOnMatch: true,
    conditions: {
      reviewType: 'PHOTO',
      minContentLength: 20,
      minMediaCount: 1,
      minRating: null,
      everyNthReview: null,
      best: null,
    },
    reward: { kind: 'POINT_FIXED', amount: 100 },
    limits: { perUser: null, global: null },
    ...overrides,
  } as UpsertRewardRuleDto;
}

describe('toUpsertRuleInput', () => {
  it('정액 규칙을 도메인 값으로 옮긴다', () => {
    const input = toUpsertRuleInput(dto());

    expect(input.reward).toEqual({ kind: 'POINT_FIXED', amount: 100, expiresInDays: null });
    expect(input.conditions.minRating).toBeNull();
    expect(input.limits).toEqual({ perUser: null, global: null });
    expect(input.startsAt).toBeNull();
  });

  it('정액인데 금액이 없으면 저장 전에 막는다', () => {
    expect(() => toUpsertRuleInput(dto({ reward: { kind: 'POINT_FIXED' } }))).toThrow(BadRequestException);
  });

  it('정률인데 비율이 없으면 막는다', () => {
    expect(() => toUpsertRuleInput(dto({ reward: { kind: 'POINT_RATE' } }))).toThrow(BadRequestException);
  });

  it('정률의 최소액이 상한보다 크면 막는다', () => {
    expect(() =>
      toUpsertRuleInput(dto({ reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: 1000, maxAmount: 500 } })),
    ).toThrow(BadRequestException);
  });

  it('주간 베스트에는 선정 방식이 있어야 한다', () => {
    expect(() => toUpsertRuleInput(dto({ trigger: 'WEEKLY_BEST' }))).toThrow(BadRequestException);
  });

  it('주간 베스트에는 정률 보상을 쓸 수 없다', () => {
    expect(() =>
      toUpsertRuleInput(
        dto({
          trigger: 'WEEKLY_BEST',
          conditions: { ...dto().conditions, best: { mode: 'HELPFUL_COUNT', topN: 3, minHelpfulCount: 1 } },
          reward: { kind: 'POINT_RATE', ratePercent: 5 },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('적용 시작이 종료보다 늦으면 막는다', () => {
    expect(() =>
      toUpsertRuleInput(dto({ startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' })),
    ).toThrow(BadRequestException);
  });
});

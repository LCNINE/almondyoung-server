import { BadRequestException } from '@nestjs/common';
import { RewardConditionsDto, RewardLimitsDto, RewardSpecDto, UpsertRewardRuleDto } from './dto/reward-rule.dto';
import { UpsertRuleInput } from './review-reward-rule.service';
import { ReviewRewardConditions, ReviewRewardLimits, ReviewRewardSpec } from './reward-rule.types';

/**
 * 관리자 입력을 도메인 값으로 옮긴다. class-validator 는 필드 하나하나만 볼 수 있으므로
 * 「정액인데 금액이 없다」 같은 조합의 모순은 여기서 잡는다 — 저장된 뒤에 발견되면
 * 판정 시점에 조용히 0원이 된다.
 */
export function toRewardSpec(dto: RewardSpecDto): ReviewRewardSpec {
  switch (dto.kind) {
    case 'NONE':
      return { kind: 'NONE' };
    case 'BADGE':
      return { kind: 'BADGE' };
    case 'POINT_FIXED': {
      if (dto.amount === undefined || dto.amount === null) {
        throw new BadRequestException('정액 보상에는 지급액이 필요합니다.');
      }
      return { kind: 'POINT_FIXED', amount: dto.amount, expiresInDays: dto.expiresInDays ?? null };
    }
    case 'POINT_RATE': {
      if (dto.ratePercent === undefined || dto.ratePercent === null) {
        throw new BadRequestException('정률 보상에는 지급 비율이 필요합니다.');
      }
      const minAmount = dto.minAmount ?? null;
      const maxAmount = dto.maxAmount ?? null;
      if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
        throw new BadRequestException('정률 보상의 최소액이 상한보다 큽니다.');
      }
      return {
        kind: 'POINT_RATE',
        ratePercent: dto.ratePercent,
        minAmount,
        maxAmount,
        expiresInDays: dto.expiresInDays ?? null,
      };
    }
  }
}

export function toConditions(dto: RewardConditionsDto): ReviewRewardConditions {
  return {
    reviewType: dto.reviewType,
    minContentLength: dto.minContentLength,
    minMediaCount: dto.minMediaCount,
    minRating: dto.minRating ?? null,
    everyNthReview: dto.everyNthReview ?? null,
    best: dto.best
      ? { mode: dto.best.mode, topN: dto.best.topN, minHelpfulCount: dto.best.minHelpfulCount }
      : null,
  };
}

export function toLimits(dto: RewardLimitsDto): ReviewRewardLimits {
  const toSpec = (spec: RewardLimitsDto['perUser']) =>
    spec ? { period: spec.period, maxCount: spec.maxCount ?? null, maxAmount: spec.maxAmount ?? null } : null;

  return { perUser: toSpec(dto.perUser), global: toSpec(dto.global) };
}

export function toUpsertRuleInput(dto: UpsertRewardRuleDto): UpsertRuleInput {
  const conditions = toConditions(dto.conditions);
  const reward = toRewardSpec(dto.reward);

  if (dto.trigger === 'WEEKLY_BEST') {
    if (!conditions.best) {
      throw new BadRequestException('주간 베스트 규칙에는 선정 방식·인원이 필요합니다.');
    }
    if (reward.kind === 'POINT_RATE') {
      throw new BadRequestException('주간 베스트 규칙에는 정률 보상을 쓸 수 없습니다 — 주문 금액에 붙는 보상이 아닙니다.');
    }
  }

  const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
  const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
  if (startsAt && endsAt && startsAt > endsAt) {
    throw new BadRequestException('적용 시작 시각이 종료 시각보다 늦습니다.');
  }

  return {
    name: dto.name,
    description: dto.description ?? null,
    trigger: dto.trigger,
    active: dto.active,
    priority: dto.priority,
    stopOnMatch: dto.stopOnMatch,
    conditions,
    reward,
    limits: toLimits(dto.limits),
    startsAt,
    endsAt,
  };
}

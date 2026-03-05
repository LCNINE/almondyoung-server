/**
 * UGC Domain Stream Configuration
 *
 * 리뷰 리워드 등 UGC 도메인의 커맨드를 정의합니다.
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Command Payloads =====

export interface EarnPointsRequestedPayload {
  reviewId: string;
  userId: string;
  reviewType: 'TEXT' | 'PHOTO';
  amount: number;
  reasonCode: string;
  productId: string;
  requestedAt: string;
}

// ===== Zod Schemas =====

const EarnPointsRequestedSchema = z.object({
  reviewId: z.string().uuid(),
  userId: z.string().uuid(),
  reviewType: z.enum(['TEXT', 'PHOTO']),
  amount: z.number().int().positive(),
  reasonCode: z.string().min(1),
  productId: z.string().uuid(),
  requestedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const UGC_COMMAND_STREAM = stream({
  topic: 'ugc.commands.v1',
  partitions: 3,
  aggregateType: 'UGC',
  events: {
    EarnPointsRequested: event<'EarnPointsRequested', EarnPointsRequestedPayload>(
      'EarnPointsRequested',
      EarnPointsRequestedSchema,
    ),
  },
});

export type UgcCommandEvents = typeof UGC_COMMAND_STREAM.events;

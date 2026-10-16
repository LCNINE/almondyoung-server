import { z } from 'zod';

export const attendanceReviewSchema = z.strictObject({
  summary: z.string().max(3000),
  evidence: z.array(z.string().max(1000)).max(8),
  questions: z.array(z.string().max(1000)).max(8),
  opinion: z.enum(['reviewable', 'needs_information', 'undetermined']),
});

export const attendanceAiResponseSchema = z.object({
  result: attendanceReviewSchema,
  model: z.string().max(100),
  promptVersion: z.string().max(100),
});

export function unwrapAttendanceResponse(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in value) {
    return value.data;
  }

  return value;
}

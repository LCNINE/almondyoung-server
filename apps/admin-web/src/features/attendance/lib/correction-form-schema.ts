import { z } from 'zod';

const optionalTimestamp = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}:00+09:00`))),
    '날짜와 시각을 확인해 주세요.'
  );

export const correctionFormSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '근무일을 선택해 주세요.'),
    checkIn: optionalTimestamp,
    checkOut: optionalTimestamp,
    reason: z
      .string()
      .trim()
      .min(1, '상세 사유를 입력해 주세요.')
      .max(5000, '상세 사유는 5,000자까지 입력할 수 있어요.'),
  })
  .superRefine((values, context) => {
    if (!values.checkIn && !values.checkOut) {
      context.addIssue({
        code: 'custom',
        path: ['checkIn'],
        message: '실제 출근 또는 실제 퇴근 시각을 하나 이상 선택해 주세요.',
      });
    }

    if (
      values.checkIn &&
      values.checkOut &&
      values.checkOut <= values.checkIn
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checkOut'],
        message: '퇴근 날짜와 시각은 출근 이후로 선택해 주세요.',
      });
    }
  });

export type CorrectionFormValues = z.infer<typeof correctionFormSchema>;

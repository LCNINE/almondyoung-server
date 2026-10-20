import { correctionFormSchema } from './correction-form-schema';

const valid = {
  day: '2026-10-19',
  checkIn: '2026-10-19T09:00',
  checkOut: '',
  reason: '출근 기록 누락',
};

it('explains both missing time and missing reason', () => {
  const result = correctionFormSchema.safeParse({
    ...valid,
    checkIn: '',
    reason: '   ',
  });

  expect(result.success).toBe(false);

  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(['checkIn', 'reason'])
    );
  }
});

it('accepts either time and trims the reason', () => {
  expect(
    correctionFormSchema.parse({ ...valid, reason: '  기록 누락  ' }).reason
  ).toBe('기록 누락');
  expect(
    correctionFormSchema.safeParse({
      ...valid,
      checkIn: '',
      checkOut: '2026-10-19T18:00',
    }).success
  ).toBe(true);
});

it('rejects reversed timestamps but allows an overnight checkout', () => {
  expect(
    correctionFormSchema.safeParse({ ...valid, checkOut: '2026-10-19T08:00' })
      .success
  ).toBe(false);
  expect(
    correctionFormSchema.safeParse({ ...valid, checkOut: '2026-10-20T02:00' })
      .success
  ).toBe(true);
});

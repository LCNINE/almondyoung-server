import { BadRequestError } from '@app/shared';
import { previousRange, StatisticsQuery } from './statistics.query';

describe('previousRange', () => {
  it('직전 동일 길이 기간을 만든다 (하루짜리)', () => {
    expect(previousRange('2026-08-24', '2026-08-24')).toEqual({ from: '2026-08-23', to: '2026-08-23' });
  });

  it('직전 동일 길이 기간을 만든다 (여러 날, 월 경계)', () => {
    expect(previousRange('2026-08-01', '2026-08-07')).toEqual({ from: '2026-07-25', to: '2026-07-31' });
  });

  it('연 경계를 넘는다', () => {
    expect(previousRange('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('StatisticsQuery 기간 검증', () => {
  it('뒤집힌 기간은 DB 를 건드리기 전에 거부한다', async () => {
    const dbService = {
      get db() {
        throw new Error('DB 에 닿으면 안 된다');
      },
    };
    const query = new StatisticsQuery(dbService as never);

    await expect(query.getSales('2026-08-24', '2026-08-01')).rejects.toBeInstanceOf(BadRequestError);
    await expect(query.getProducts('2026-08-24', '2026-08-01')).rejects.toBeInstanceOf(BadRequestError);
    await expect(query.getCustomers('2026-08-24', '2026-08-01')).rejects.toBeInstanceOf(BadRequestError);
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { AdminKeywordController } from '../admin-keyword.controller';
import { AdminKeywordStatisticsQueryDto } from './admin-keyword-statistics.dto';

async function errorsFor(query: Record<string, unknown>) {
  const dto = plainToInstance(AdminKeywordStatisticsQueryDto, query);
  return validate(dto);
}

describe('AdminKeywordStatisticsQueryDto 날짜 검증', () => {
  it('실재하는 날짜 기간은 통과한다', async () => {
    const errors = await errorsFor({ from: '2026-08-01', to: '2026-08-24' });
    expect(errors).toHaveLength(0);
  });

  it('모양은 맞지만 달력에 없는 날짜를 거부한다', async () => {
    // 모양 검증만 있으면 통과해 kstDayStartIso 의 toISOString() 에서 500 으로 터지던 값들
    for (const invalid of ['2026-02-31', '2026-13-45', '2027-02-29']) {
      const errors = await errorsFor({ from: invalid, to: '2026-08-24' });
      expect(errors.map((e) => e.property)).toContain('from');
    }
  });

  it('타임스탬프·부분 ISO 를 거부한다', async () => {
    for (const invalid of ['2026-08', '2026-08-01T00:00:00Z', '20260801']) {
      const errors = await errorsFor({ from: '2026-08-01', to: invalid });
      expect(errors.map((e) => e.property)).toContain('to');
    }
  });
});

describe('AdminKeywordController 가드 배선', () => {
  it('JwtAuthGuard 와 AdminRealmGuard 가 컨트롤러 클래스에 걸려 있다', () => {
    // 모든 서비스가 AUTH_SECRET 을 공유하므로 인증만으로는 고객 토큰도 통과한다.
    // staff role 강제(AdminRealmGuard)가 빠지면 관리자 통계가 고객에게 열린다.
    const guards: unknown[] = Reflect.getMetadata('__guards__', AdminKeywordController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(AdminRealmGuard);
  });
});

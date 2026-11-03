import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 계정 변경·탈퇴·휴면 전환·영구 삭제를 내는 곳은 전부 `inAccountTenant` 안에서 낸다(ADR-0056).
 * 그냥 내면 봉투가 요청 화면의 테넌트나 앱 설정 T 로 찍혀, 테넌트 2 계정의 탈퇴가 테넌트 1 서비스에 닿는다 — 아무 데서도 안 빨개진다.
 * 판정: 그 `eventType` 줄 바로 위 몇 줄 안에 `inAccountTenant(` 가 있다.
 */
const ACCOUNT_EVENT_TYPES = ['UserUpdated', 'UserDeleted', 'UserDormantConverted', 'UserPermanentDeleted'];
const LOOKBACK_LINES = 3;

const REPO = join(__dirname, '..', '..', '..', '..');
const sources = execFileSync('git', ['ls-files', '--', 'apps/user-service/src/*.ts'], { cwd: REPO, encoding: 'utf8' })
  .split('\n')
  .filter((p) => p && !p.endsWith('.spec.ts'));

function producerSites(): { site: string; wrapped: boolean }[] {
  const pattern = new RegExp(`eventType: '(${ACCOUNT_EVENT_TYPES.join('|')})'`);
  return sources.flatMap((path) => {
    const lines = readFileSync(join(REPO, path), 'utf8').split('\n');
    return lines.flatMap((line, i) =>
      pattern.test(line)
        ? [
            {
              site: `${path}:${i + 1}`,
              wrapped: lines.slice(Math.max(0, i - LOOKBACK_LINES), i).some((l) => l.includes('inAccountTenant(')),
            },
          ]
        : [],
    );
  });
}

describe('계정 이벤트 생산 지점', () => {
  it('찾는다 — 0 이면 이 검사가 헛돈다', () => {
    expect(producerSites().length).toBeGreaterThanOrEqual(6);
  });

  it('전부 inAccountTenant 안에서 낸다', () => {
    expect(producerSites().filter((s) => !s.wrapped).map((s) => s.site)).toEqual([]);
  });
});

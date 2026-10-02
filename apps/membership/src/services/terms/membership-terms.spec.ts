import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import * as path from 'path';
import { TermsAgreementManager } from './terms-agreement.manager';
import {
  CURRENT_MEMBERSHIP_TERMS_VERSION,
  MEMBERSHIP_TERMS_VERSIONS,
  isKnownMembershipTermsVersion,
} from './membership-terms';

const repoRoot = path.resolve(__dirname, '../../../../..');
const storefrontDir = path.join(repoRoot, 'web/almondyoung-storefront/src/domains/membership');

/**
 * 약관 «문언»과 동의 기록에 남는 «버전 이름»이 갈리지 않게 한다.
 *
 * 문언을 고치고 버전을 안 올리면, 새 문언에 동의한 사람이 옛 버전 이름으로 기록된다 — 분쟁 때
 * 「그 버전의 문언」을 꺼내면 그 사람이 본 것과 다르다. 오류도 로그도 없이 기록만 틀린다.
 */
describe('멤버십 약관 버전의 정본', () => {
  it('약관 본문 파일이 최신 버전에 적힌 해시와 같다 — 본문을 고쳤으면 버전을 올려라', () => {
    const body = readFileSync(path.join(storefrontDir, 'components/terms-and-conditions.tsx'));
    const sha256 = createHash('sha256').update(body).digest('hex');

    expect(sha256).toBe(MEMBERSHIP_TERMS_VERSIONS[MEMBERSHIP_TERMS_VERSIONS.length - 1].sha256);
  });

  it('가입 화면이 보내는 버전이 서버의 최신 버전과 같다', () => {
    const source = readFileSync(path.join(storefrontDir, 'terms-version.ts'), 'utf8');
    const match = source.match(/MEMBERSHIP_TERMS_VERSION\s*=\s*"([^"]+)"/);

    expect(match?.[1]).toBe(CURRENT_MEMBERSHIP_TERMS_VERSION);
  });

  it('버전 이름은 겹치지 않는다', () => {
    const names = MEMBERSHIP_TERMS_VERSIONS.map((v) => v.version);
    expect(new Set(names).size).toBe(names.length);
    expect(isKnownMembershipTermsVersion(CURRENT_MEMBERSHIP_TERMS_VERSION)).toBe(true);
    expect(isKnownMembershipTermsVersion('1999-01-01')).toBe(false);
  });
});

describe('동의 없는 가입', () => {
  const managerWith = (required: string | undefined) =>
    new TermsAgreementManager({ db: {} } as never, { get: () => required } as never);

  it('필수로 켜져 있으면 동의 없이 온 가입을 거절한다', async () => {
    await expect(managerWith('true').resolveForSubscription('u1', undefined, 'p1', 'recurring')).rejects.toThrow(
      '약관 동의가 필요합니다',
    );
  });

  it('꺼져 있는 동안엔 동의 없이 와도 지금처럼 가입된다', async () => {
    await expect(managerWith('false').resolveForSubscription('u1', undefined, 'p1', 'recurring')).resolves.toBeNull();
    await expect(managerWith(undefined).resolveForSubscription('u1', undefined, 'p1', 'recurring')).resolves.toBeNull();
  });
});

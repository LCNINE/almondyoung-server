import { maskConnectionStrings } from '../mask-secrets';

/**
 * 이 파일의 픽스처 호스트는 전부 `localhost` / `127.0.0.1` 이다 — 실제 도메인처럼 보이는
 * 호스트(`db.example.com` 등)를 쓰면 `scripts/security/no-cloud-credentials.spec.ts` 의
 * 전역 크레덴셜 스캐너가 이 파일을 "실제 크레덴셜"로 오인해 게이트를 빨갛게 만든다
 * (`[REDACTED]` 는 그 스캐너의 자리표시자 판정 기준을 만족하지 않는다 — 대괄호로 시작해서
 * ALL-CAPS 토큰도, `<...>` 토큰도 아니다). 호스트를 "더 그럴듯하게" 바꾸지 말 것 — 값
 * 자체는 `maskConnectionStrings` 가 호스트를 보지 않으므로 어떤 문자열이든 테스트 의미는
 * 그대로다.
 */
describe('maskConnectionStrings', () => {
  it('접속 문자열의 비밀번호만 치환하고 나머지는 보존한다', () => {
    expect(maskConnectionStrings('postgresql://postgres:s3cr3t@localhost:5432/medusa')).toBe(
      'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
    );
  });

  it('비밀번호가 없는 URL 은 바꾸지 않는다', () => {
    expect(maskConnectionStrings('postgresql://localhost:5432/medusa')).toBe(
      'postgresql://localhost:5432/medusa',
    );
  });

  it('사용자명이 비어 있어도 비밀번호를 치환한다', () => {
    expect(maskConnectionStrings('redis://:p4ss@localhost:6379')).toBe(
      'redis://:[REDACTED]@localhost:6379',
    );
  });

  it('한 문자열 안의 여러 접속 문자열을 모두 치환한다', () => {
    const input =
      'primary=postgresql://a:pw1@localhost:5432/d1 replica=postgresql://b:pw2@127.0.0.1:5432/d2';
    expect(maskConnectionStrings(input)).toBe(
      'primary=postgresql://a:[REDACTED]@localhost:5432/d1 replica=postgresql://b:[REDACTED]@127.0.0.1:5432/d2',
    );
  });

  it('에러 메시지 안에 박힌 접속 문자열도 치환한다', () => {
    const input =
      'connection to server failed: postgresql://postgres:s3cr3t@localhost:5432/medusa (timeout)';
    expect(maskConnectionStrings(input)).toBe(
      'connection to server failed: postgresql://postgres:[REDACTED]@localhost:5432/medusa (timeout)',
    );
  });

  it('자격증명이 없는 URL 과 평문은 그대로 둔다', () => {
    expect(maskConnectionStrings('https://example.com/path')).toBe('https://example.com/path');
    expect(maskConnectionStrings('접속 정보 없음')).toBe('접속 정보 없음');
  });

  it('빈 문자열을 처리한다', () => {
    expect(maskConnectionStrings('')).toBe('');
  });

  it('비밀번호에 포함된 @ 를 전부 치환한다', () => {
    expect(maskConnectionStrings('postgresql://user:p@ssword@localhost:5432/db')).toBe(
      'postgresql://user:[REDACTED]@localhost:5432/db',
    );
  });

  it('쿼리스트링의 @ 를 삼키지 않는다', () => {
    expect(maskConnectionStrings('postgresql://u:p@localhost/db?opt=a@b')).toBe(
      'postgresql://u:[REDACTED]@localhost/db?opt=a@b',
    );
  });

  it('이미 치환된 문자열에 다시 적용해도 결과가 같다 (멱등)', () => {
    const original = 'postgresql://postgres:s3cr3t@localhost:5432/medusa';
    const masked = maskConnectionStrings(original);
    const reMasked = maskConnectionStrings(masked);
    expect(reMasked).toBe(masked);
  });

  // 아래 두 케이스는 과잉 마스킹이다. 고치지 말 것 — 좁히면 해당 문자가 든
  // 비밀번호에서 다시 샌다. under-mask(유출)보다 over-mask(정보 손실)를 택한 결과다.
  it('경로 없는 URL 뒤에 구분자 없이 @ 가 오면 과잉 마스킹된다 (의도된 트레이드오프)', () => {
    expect(maskConnectionStrings('postgresql://user:pass@localhost:5432,ops@127.0.0.1:1')).toBe(
      'postgresql://user:[REDACTED]@127.0.0.1:1',
    );
  });

  it('경로가 있으면 과잉 마스킹되지 않는다 — 실제 접속 문자열의 형태다', () => {
    expect(
      maskConnectionStrings('postgresql://user:pass@localhost:5432/medusa?sslmode=require ops@company.com'),
    ).toBe('postgresql://user:[REDACTED]@localhost:5432/medusa?sslmode=require ops@company.com');
  });
});

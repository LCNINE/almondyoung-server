import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTROLLERS_DIR = join(__dirname, '..');

/**
 * `request.user` 에는 `id` 가 없다. AuthenticationService.validatePayload 가 토큰의
 * `sub` 를 `userId` 로 옮겨 담기 때문이다. 그런데 `JwtPayload` 타입은 `id` 를 선언해서
 * `user.id` 가 타입 검사를 통과한다 — 컴파일은 되고 런타임에 undefined 가 된다.
 *
 * 실제로 그렇게 났다: 세션 INSERT 의 user_id 가 null 이 되어 not-null 제약에 걸렸고,
 * 화면에는 "대화를 시작하지 못했습니다" 만 떴다.
 */
describe('컨트롤러는 request.user 에서 userId 를 읽는다', () => {
  const files = readdirSync(CONTROLLERS_DIR).filter((name) => name.endsWith('.controller.ts'));

  it('컨트롤러 파일이 있다', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s 은 user.id 를 쓰지 않는다', (file) => {
    const source = readFileSync(join(CONTROLLERS_DIR, file), 'utf8');
    expect(source).not.toMatch(/\buser\.id\b/);
  });
});

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { tokenTenantOf } from './isolation-check/judge';
import { stageServiceUrl } from './isolation-check/live-config';
import { authParameter, needSecret, secretsOf } from './sst-live';
import { signInStaff } from './staff-token';

const TOKEN_REUSE_MS = 10 * 60_000;

function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolveAnswer(answer.trim());
    });
    muted = hidden;
  });
}

/**
 * 운영자가 직접 로그인한 토큰(admin-web 클라이언트, 테넌트 1 주소) — 테넌트 만들기(라이브)와 격리 실측 쓰기 부분이 쓴다.
 * 운영자 비밀번호는 Secret 에 두지 않는다: 화면에 안 보이게 받는다. 수명 15분이라 10분마다 다시 받는다.
 */
export async function operatorSession(stage: string): Promise<{ users: string; token: () => Promise<string> }> {
  const services = secretsOf(stage, 'lcnine-services');
  const auth = secretsOf(stage, 'lcnine-auth');
  const users = authParameter(stage, 'user-service-url');
  const servedTenant = authParameter(stage, 'served-tenant-id');
  const client = {
    baseUrl: users,
    internalSecret: needSecret(auth, 'OauthInternalSecret', 'lcnine-auth'),
    clientId: 'admin-web',
    clientSecret: needSecret(services, 'AdminWebOidcClientSecret', 'lcnine-services'),
    redirectUri: `${stageServiceUrl(stage, 'admin')}/auth/callback`,
  };
  const loginId = await ask('운영자 아이디: ', false);
  const password = await ask('운영자 비밀번호(안 보인다): ', true);
  let cached: { token: string; at: number } | null = null;
  const token = async () => {
    if (cached && Date.now() - cached.at < TOKEN_REUSE_MS) return cached.token;
    const t = await signInStaff(client, loginId, password, servedTenant);
    if (tokenTenantOf(t) !== servedTenant) {
      throw new Error(
        `운영자 토큰의 테넌트가 ${tokenTenantOf(t) ?? '없음'} 이다 — 테넌트 1(${servedTenant}) 주소로 받아야 한다`,
      );
    }
    cached = { token: t, at: Date.now() };
    return t;
  };
  await token(); // 틀린 비밀번호는 시작 전에
  return { users, token };
}

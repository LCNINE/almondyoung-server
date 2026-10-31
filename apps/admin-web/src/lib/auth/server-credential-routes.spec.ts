import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * admin-web 서버가 쥔 자격증명을 읽는 곳을 소스에서 모아, 테넌트 판정 없이 업스트림을 부르는 라우트가 생기면 빨갛게 한다.
 * 그 업스트림(한 테넌트 T 만 섬기는 Medusa·channel-adapter …)은 사람 토큰을 보지 않아 공유 서비스 문이 닿지 않는다.
 * 새 자격증명은 아래 두 표 중 하나에 적어야 한다 — 어느 쪽인지 정하지 않은 채로는 초록이 되지 않는다.
 */
const ADMIN_WEB = join(__dirname, '..', '..', '..');
const SRC = join(ADMIN_WEB, 'src');

/** T 만 섬기는 업스트림을 여는 자격증명 — 읽는 곳은 라우트 핸들러뿐이고, 그 핸들러는 판정을 거친다. */
const GATED = ['CHANNEL_ADAPTER_INTERNAL_KEY', 'MEDUSA_API_KEY'];

/** 테넌트 데이터를 열지 않는 자격증명과 그 이유. */
const NOT_TENANT_DATA: Record<string, string> = {
  OIDC_CLIENT_SECRET: '로그인 코드를 토큰으로 바꾼다 — 토큰 테넌트는 user-service 가 정한다',
  KAKAO_REST_API_KEY: '카카오 주소 검색 — 외부 공용 데이터',
  GRAFANA_OTLP_TOKEN: '관측 데이터를 내보내기만 한다',
};

const CREDENTIAL = /\b((?!NEXT_PUBLIC_)[A-Z][A-Z0-9_]*_(?:KEY|SECRET|TOKEN|PASSWORD))\b/g;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.spec\./.test(name)) out.push(p);
  }
  return out;
}

// 환경변수로 읽는 것만 센다: `process.env.X`, 그리고 env 를 통째로 받는 파일(`process.env[이름]` — `lib/auth/env.ts` 의
// required('X') 등 — 이나 `const { X } = process.env`) 안의 이름. 화면 상수('NEW_ROUTE_DRAFT_KEY')는 세지 않는다.
function readsEnv(name: string, src: string): boolean {
  if (new RegExp(`process\\.env\\.${name}\\b`).test(src)) return true;
  if (/process\.env\[/.test(src) && new RegExp(`['"\`]${name}['"\`]`).test(src)) return true;
  return new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*process\\.env\\b`).test(src);
}

const uses = files(SRC).flatMap((file) => {
  const src = readFileSync(file, 'utf8');
  const names = [...new Set([...src.matchAll(CREDENTIAL)].map((m) => m[1]))].filter((n) => readsEnv(n, src));
  return names.map((name) => ({ name, file: relative(ADMIN_WEB, file), src }));
});

describe('admin-web 서버 자격증명 라우트의 테넌트 판정', () => {
  it('자격증명 사용처를 찾았다 — 못 찾으면 아래 대조가 아무것도 안 잰다', () => {
    const found = new Set(uses.map((u) => u.name));
    for (const name of [...GATED, ...Object.keys(NOT_TENANT_DATA)]) expect(found).toContain(name);
  });

  it('모든 서버 자격증명이 «판정 필요» 또는 «테넌트 데이터 아님» 으로 분류돼 있다', () => {
    const unclassified = uses
      .filter((u) => !GATED.includes(u.name) && !(u.name in NOT_TENANT_DATA))
      .map((u) => `${u.name} @ ${u.file}`);
    expect(unclassified).toEqual([]);
  });

  it('T 만 섬기는 업스트림의 자격증명은 라우트 핸들러에서만 읽고, 그 핸들러는 판정을 거친다', () => {
    const offenders = uses
      .filter((u) => GATED.includes(u.name))
      .filter((u) => !/^src\/app\/api\/.+\/route\.ts$/.test(u.file) || !/admitServerCredentialTenant\(/.test(u.src))
      .map((u) => `${u.name} @ ${u.file}`);
    expect(offenders).toEqual([]);
  });
});

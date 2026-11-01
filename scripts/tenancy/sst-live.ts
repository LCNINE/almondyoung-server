import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseSecretList } from './isolation-check/live-config';
import { deploymentToCwd } from '../seeding/lib/sst-shell-relaunch';

/**
 * 라이브 도구(격리 실측·테넌트 만들기)가 SST Secret 과 lcnine-auth 의 SSM 값을 읽고 쓰는 길. 비밀은 여기로만 오간다 —
 * env·파일·명령줄 인자로 받지 않는다(셸 이력·디스크·`ps` 에 남는다).
 */
const ROOT = resolve(__dirname, '../..');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

export type LiveDeployment = 'lcnine-services' | 'lcnine-auth';

export function secretsOf(stage: string, deployment: LiveDeployment): Map<string, string> {
  try {
    const stdout = execFileSync('npx', ['sst', 'secret', 'list', '--stage', stage], {
      cwd: join(ROOT, deploymentToCwd(deployment)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseSecretList(stdout);
  } catch {
    throw new Error(`${deployment} 의 SST Secret 을 못 읽었다 — AWS 로그인(aws login --profile login)을 확인한다`);
  }
}

/** 값은 stdin 으로 넘긴다(`sst secret set <이름> < 파일` 과 같은 길) — 명령줄에 싣지 않는다. */
export function setSecret(stage: string, deployment: LiveDeployment, name: string, value: string): void {
  try {
    execFileSync('npx', ['sst', 'secret', 'set', name, '--stage', stage], {
      cwd: join(ROOT, deploymentToCwd(deployment)),
      input: value,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  } catch {
    // 오류 출력엔 값이 실릴 수 있어 싣지 않는다.
    throw new Error(`${deployment} 의 Secret ${name} 을 못 넣었다 — AWS 로그인을 확인한다`);
  }
}

export function needSecret(map: Map<string, string>, name: string, deployment: string): string {
  const v = map.get(name);
  if (!v) throw new Error(`${deployment} 에 Secret ${name} 가 없다`);
  return v;
}

/** lcnine-auth 가 publish 한 SSM 값(user-service 주소·앱 설정 T). */
export function authParameter(stage: string, key: string): string {
  const name = `/lcnine-auth/${stage}/${key}`;
  return execFileSync(
    'aws',
    ['ssm', 'get-parameter', '--name', name, '--with-decryption', '--query', 'Parameter.Value', '--output', 'text'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AWS_REGION: REGION } },
  ).trim();
}

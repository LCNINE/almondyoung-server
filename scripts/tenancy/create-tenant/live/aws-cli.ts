import { execFile } from 'node:child_process';

/**
 * `aws` CLI 한 겹. 라이브 어댑터(S3·IAM·ACM·Route53·RDS·CloudFront)는 전부 이걸로 부른다 — SDK 를 새로 들이지 않고
 * (레포엔 S3·STS 클라이언트뿐), 운영자 머신의 자격증명 체인(`aws login --profile login`)을 그대로 쓴다.
 * 출력은 JSON 으로 받는다. 실패는 AWS 오류 코드(`NoSuchEntity`·`404` …)를 실은 `AwsCliError` 다.
 */
export class AwsCliError extends Error {
  constructor(
    readonly code: string,
    readonly stderr: string,
  ) {
    super(`aws 오류 ${code}: ${stderr.trim().slice(0, 300)}`);
    this.name = 'AwsCliError';
  }
}

/**
 * `env` 를 주면 그 env «만»으로 돈다(운영자 자격증명을 섞지 않으려고 — 버킷 확인은 file-service 키 하나로).
 *
 * 응답은 `unknown` 이고 부르는 쪽이 그 AWS API 의 응답 모양으로 좁힌다(`as`). 운영자 머신에서 사람이 돌리는 일회성
 * 도구라 응답 스키마 검증을 두지 않았다 — 모양이 다르면 그 자리에서 TypeError 로 멈추고, 멈춤은 되돌리기·재실행으로
 * 이어지는 단계 러너 안이다. 쓰기 전 판정(«이미 됐나»)은 spec 의 가짜 CLI 로 잰다.
 */
export type Aws = (args: string[], opts?: { region?: string; env?: NodeJS.ProcessEnv }) => Promise<unknown>;

export const isAwsError = (e: unknown, ...codes: string[]): e is AwsCliError =>
  e instanceof AwsCliError && codes.includes(e.code);

export function awsCli(defaultRegion: string): Aws {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        'aws',
        [...args, '--region', opts.region ?? defaultRegion, '--output', 'json'],
        { env: opts.env ?? process.env, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) {
            const code = /An error occurred \(([^)]+)\)/.exec(stderr)?.[1] ?? `exit ${String(error.code ?? '?')}`;
            reject(new AwsCliError(code, stderr || error.message));
            return;
          }
          const text = stdout.trim();
          resolve(text ? JSON.parse(text) : null);
        },
      );
    });
}

/** CLI 응답과 원하는 설정의 비교 — 배열 순서와 키 순서에 흔들리지 않는다(빠진 칸·더 있는 칸은 다르다로 본다) */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${k}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sameJson = (a: unknown, b: unknown) => canonical(a) === canonical(b);

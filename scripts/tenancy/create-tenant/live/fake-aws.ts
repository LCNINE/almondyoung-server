import { AwsCliError, type Aws } from './aws-cli';

/**
 * spec 용 가짜 `aws` CLI. 응답은 `(args) => 값 | AwsCliError` 표로 주고, 모든 호출을 기록한다.
 * 쓰기 호출(`create-`·`put-`·`delete-`·`request-`·`change-`)만 모아 «이미 맞으면 아무것도 안 쓴다»를 잰다.
 */
export function fakeAws(respond: (args: string[]) => unknown) {
  const calls: string[][] = [];
  const aws: Aws = async (args) => {
    calls.push(args);
    const r = respond(args);
    if (r instanceof AwsCliError) throw r;
    return r;
  };
  const writes = () =>
    calls.filter((c) => /^(create|put|delete|request|change)-/.test(c[1] ?? '')).map((c) => `${c[0]} ${c[1]}`);
  return { aws, calls, writes };
}

export const awsError = (code: string) => new AwsCliError(code, `An error occurred (${code}) when calling …`);

/** `--name value` 꼴 인자 하나 */
export function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

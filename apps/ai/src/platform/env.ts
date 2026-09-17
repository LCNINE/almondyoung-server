/**
 * 숫자 env 를 읽는다. `??` 를 쓰면 안 되는 이유: `FOO=` 는 빈 문자열이라 `??` 를
 * 통과하고 `Number('')` 가 0 이 된다. env 템플릿이 값 없는 키를 그렇게 남겨 둔다.
 *
 * 숫자가 아니거나 0 이하면 기본값을 쓴다. 0 이 쓸모 있는 설정은 없다.
 */
export function positiveNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** URL env. 빈 문자열이면 기본값을 쓰고, 뒤 슬래시는 떼서 준다. */
export function urlEnv(key: string, fallback: string): string {
  return (process.env[key] || fallback).replace(/\/+$/, '');
}

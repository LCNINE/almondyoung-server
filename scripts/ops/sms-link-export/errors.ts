/** 오류를 한 줄로. drizzle 쿼리 오류는 `Failed query: …\nparams: …` 꼴이라 params(번호·회원 id)를 빼고 원인만 남긴다. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return error.message.split(/\nparams:/)[0];
}

/** Medusa 워크플로는 Error 가 아닌 평범한 객체를 던진다 — «[object Object]» 가 되지 않게 읽을 수 있는 문장으로 바꾼다. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

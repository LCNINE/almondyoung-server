import "server-only";

export type ApiEnvelope<T> = { success: boolean; data: T };

export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `user-service returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    );
  }
}

export async function readApiData<T>(res: Response): Promise<T> {
  const body = await readJson<ApiEnvelope<T>>(res);
  return body.data;
}

export async function throwIfBad(res: Response, ctx: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  let message = text;
  try {
    const body = JSON.parse(text);
    message = body?.message ?? text;
    if (Array.isArray(message)) message = message.join(", ");
  } catch {
    // keep raw
  }
  throw new ApiError(res.status, `[${ctx}] ${res.status}: ${message}`, message);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * 서버가 내려준 원본 메시지. `message` 는 `[ctx] status: ...` 접두사가 붙은 디버깅용이라
     * 사용자에게 그대로 보여주면 안 된다. 화면에 노출할 때는 이 값을 쓴다.
     */
    public readonly serverMessage: string = message,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

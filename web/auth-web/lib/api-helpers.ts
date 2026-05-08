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
  throw new ApiError(res.status, `[${ctx}] ${res.status}: ${message}`);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

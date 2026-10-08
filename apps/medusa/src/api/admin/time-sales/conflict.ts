import type { MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';

// 워크플로의 CONFLICT 에러만 409 + 메시지로 바꿔 응답한다(그
// 외 에러는 그대로 던진다). ok:false 면 이미 응답한 상태.
export async function respondConflictWithMessage<T>(res: MedusaResponse, run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    const conflict = error as { type?: unknown; message?: unknown };
    if (conflict?.type !== MedusaError.Types.CONFLICT || typeof conflict.message !== 'string') throw error;

    res.status(409).json({ type: MedusaError.Types.CONFLICT, message: conflict.message });

    return { ok: false as const };
  }
}

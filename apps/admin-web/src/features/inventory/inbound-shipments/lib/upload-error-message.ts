export const SHAPE_LIMIT_MESSAGE = '파일 모양이 한도를 넘습니다(열 64개·행 5,000개·칸 2,000자).';

/** 올리기 실패의 사유 문구. class-validator 400(배열)은 한도 안내로, core 의 한국어 문구는 그대로. */
export function uploadErrorMessage(error: unknown): string {
  const e = error as
    | { response?: { status?: number; data?: { message?: unknown } }; message?: unknown }
    | null
    | undefined;
  const status = e?.response?.status;
  const serverMessage = e?.response?.data?.message;
  if (status === 400 && Array.isArray(serverMessage)) return SHAPE_LIMIT_MESSAGE;
  if (typeof serverMessage === 'string' && serverMessage) return serverMessage;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return '올리지 못했습니다.';
}

import { uploadErrorMessage } from '../../lib/upload-error-message';

/** 쓰기 실패 문구 — 서버 문구를 그대로 쓴다(추출은 올리기와 같은 길). */
export function writeErrorMessage(error: unknown): string {
  const text = uploadErrorMessage(error);
  return text === '올리지 못했습니다.' ? '저장하지 못했습니다.' : text;
}

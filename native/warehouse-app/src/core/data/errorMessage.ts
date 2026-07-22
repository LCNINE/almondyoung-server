import { ConflictError } from './httpClient';

export function errorMessage(error: unknown): string {
  if (error instanceof ConflictError) {
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
    if (status === 401 || status === 403) return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
  }
  return '알 수 없는 오류가 발생했어요.';
}

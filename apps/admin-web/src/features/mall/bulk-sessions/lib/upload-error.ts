// '@/' 는 admin-web jest 설정에 moduleNameMapper 가 없어 값 import 를 해석하지 못한다
// (타입 전용 import 만 erasure 로 안전하다). 상대경로로 우회한다 — 이 모듈은
// parseUploadError() 안에서 parseServerError 를 실제로 호출하므로 값 import 다.
import { parseServerError } from '../../../../lib/api/server-error';

/** 서버 상한과 같은 값. bulk-upload.parser.ts 의 MAX_UPLOAD_BYTES 와 어긋나면 안 된다. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * bulk-session.manager.ts 의 `EXPORT_UNUSABLE_MESSAGE` 와 같은 문자열이어야 한다 —
 * 이 메시지일 때만 "양식 만료" 안내로 옮긴다. 어긋나면 이 특수 케이스가 조용히 죽고
 * 만료 400 이 다시 서버 원문으로 노출된다.
 */
const EXPORT_UNUSABLE_MESSAGE =
  '이 양식은 더 이상 사용할 수 없습니다. 양식을 다시 받아 작업해 주세요.';

/**
 * 업로드 실패를 작업자가 행동할 수 있는 문구로 옮긴다.
 *
 * 400 은 원인이 하나가 아니다 — 만료된 exportId(`EXPORT_UNUSABLE_MESSAGE`)뿐 아니라
 * 잘못된 파일 형식·필수 시트/열 누락·행수 상한 초과 등 파일 형태 오류도 전부 400 이다
 * (bulk-upload.parser.ts). 전자만 스펙 §3.1 이 말하는 "양식 만료" 안내로 바꾼다 —
 * 나머지를 같은 문구로 덮으면 예를 들어 행수 초과로 거부된 작업자가 "양식을 다시
 * 받으라"는 말만 보고 똑같은 파일을 다시 채워 올리는 루프에 빠진다.
 */
export function parseUploadError(error: unknown): string {
  const parsed = parseServerError(error, '업로드에 실패했습니다.');
  if (parsed.status === 400 && parsed.message === EXPORT_UNUSABLE_MESSAGE) {
    return '양식이 만료되었습니다. 상품 목록에서 양식을 다시 받아 작성해 주세요.';
  }
  if (parsed.status === 403) return '이 기능은 admin·master 권한이 필요합니다.';
  if (parsed.status === 413)
    return '파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.';
  return parsed.message;
}

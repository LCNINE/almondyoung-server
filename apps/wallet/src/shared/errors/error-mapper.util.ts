// apps/wallet/src/controllers/_utils/error-mapper.util.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export function mapErrorToHttpException(e: Error): HttpException {
  const msg = (e.message || '').toLowerCase();

  const is404 =
    /not\s*found/.test(msg) ||
    /찾을 수 없/.test(msg) ||
    /존재하지 않/.test(msg) ||
    /없습니다/.test(msg);

  const is400 =
    /already|exceeds|required|invalid|failed|inactive|not allowed|conflict/.test(
      msg,
    ) || /유효|형식|중복|실패|허용되지|비활성/.test(msg);

  if (is404) return new HttpException(e.message, HttpStatus.NOT_FOUND);
  if (is400) return new HttpException(e.message, HttpStatus.BAD_REQUEST);
  return new HttpException(
    'Internal server error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

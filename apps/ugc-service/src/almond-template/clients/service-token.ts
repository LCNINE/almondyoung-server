import { sign } from 'jsonwebtoken';

export const ALMOND_PRINT_SERVICE_SUBJECT = '00000000-0000-4000-8000-000000a1d001';

// ponytail: 5분 상한 — 렌더+대기열이 5분을 넘으면 실패한다. 늘려야 하면 file-service 요청마다 발급할 것.
export function mintServiceToken(secret: string): string {
  return sign({ sub: ALMOND_PRINT_SERVICE_SUBJECT, scopes: ['master'] }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

/**
 * Message ID Utilities
 *
 * ULID 기반 메시지 ID 생성
 * - 시간순 정렬 가능
 * - UUID보다 짧고 읽기 쉬움
 * - 분산 환경에서 충돌 없음
 */

import { ulid } from 'ulid';

/**
 * 새로운 메시지 ID 생성 (ULID)
 *
 * @returns ULID 문자열 (26자)
 *
 * @example
 * const messageId = generateMessageId();
 * // '01ARZ3NDEKTSV4RRFFQ69G5FAV'
 */
export function generateMessageId(): string {
  return ulid();
}

/**
 * 특정 시각의 메시지 ID 생성
 *
 * @param timestamp - Date 객체 또는 밀리초 timestamp
 *
 * @example
 * const messageId = generateMessageIdAt(new Date('2025-01-01'));
 */
export function generateMessageIdAt(timestamp: Date | number): string {
  const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  return ulid(time);
}

/**
 * ULID에서 timestamp 추출
 *
 * @param messageId - ULID 문자열
 * @returns 밀리초 timestamp
 *
 * @example
 * const timestamp = extractTimestampFromMessageId('01ARZ3NDEKTSV4RRFFQ69G5FAV');
 * const date = new Date(timestamp);
 */
export function extractTimestampFromMessageId(messageId: string): number {
  // ULID의 첫 10자는 timestamp (48비트)
  const timestampPart = messageId.substring(0, 10);
  return decodeTime(timestampPart);
}

/**
 * ULID timestamp 디코딩
 */
function decodeTime(timestampPart: string): number {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let value = 0;

  for (let i = 0; i < timestampPart.length; i++) {
    const char = timestampPart[i];
    const index = ENCODING.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    value = value * 32 + index;
  }

  return value;
}

/**
 * 메시지 ID가 유효한 ULID인지 검증
 */
export function isValidMessageId(messageId: string): boolean {
  if (typeof messageId !== 'string' || messageId.length !== 26) {
    return false;
  }

  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return messageId.split('').every((char) => ENCODING.includes(char));
}

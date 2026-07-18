import * as crypto from 'crypto';

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SPECIAL = '!@#$%^&*()_+-=';
const ALL = LOWER + UPPER + DIGIT + SPECIAL;

function pick(chars: string): string {
  return chars[crypto.randomInt(chars.length)];
}

/**
 * 관리자 계정 생성 시 서버가 발급하는 1회용 초기 비밀번호.
 * create-account/change-password DTO 의 비번 정책(영문+숫자+특수문자, 8-20자)을 항상 만족한다.
 */
export function generateInitialPassword(): string {
  const length = 16;
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

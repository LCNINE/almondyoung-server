import type { MaskableKind } from './pii-kinds';

const MASK = '*';
const HIDDEN = '[가림]';
const ELLIPSIS = '…';

/**
 * 종류별 가림 형식(개인정보 표시 제한 예시: 성명 홍*동, 연락처 010-****-1234, 주소는 시·군·구까지).
 * 문자열은 문자열로 돌려준다 — 화면의 타입이 바뀌지 않게. 빈 값은 빈 값 그대로(«없음» 과 «가림» 을 섞지 않는다).
 */
export function maskPiiValue(kind: MaskableKind, value: string): string {
  if (value.trim() === '') return value;
  switch (kind) {
    case 'name':
      return maskName(value.trim());
    case 'phone':
      return maskPhone(value);
    case 'email':
      return maskEmail(value.trim());
    case 'address':
      return maskAddress(value.trim());
    case 'postal':
      return MASK.repeat(5);
    case 'account':
      return maskAccount(value);
    case 'secret':
    case 'text':
      return HIDDEN;
  }
}

function maskName(name: string): string {
  const chars = Array.from(name);
  if (chars.length === 1) return MASK;
  if (chars.length === 2) return `${chars[0]}${MASK}`;
  return `${chars[0]}${MASK.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 숫자 기준 앞 3자리·끝 4자리만 남긴다. 구분자는 자리를 지킨다. 8자리 미만이면 숫자를 모두 가린다. */
function maskPhone(phone: string): string {
  const digitCount = phone.replace(/\D/g, '').length;
  const keepHead = digitCount < 8 ? 0 : 3;
  const keepTail = digitCount < 8 ? 0 : 4;
  let seen = 0;
  return Array.from(phone)
    .map((ch) => {
      if (!/\d/.test(ch)) return ch;
      seen += 1;
      return seen <= keepHead || seen > digitCount - keepTail ? ch : MASK;
    })
    .join('');
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  const local = at < 0 ? email : email.slice(0, at);
  const domain = at < 0 ? '' : email.slice(at);
  return `${Array.from(local).slice(0, 2).join('')}${MASK.repeat(3)}${domain}`;
}

function maskAddress(address: string): string {
  const tokens = address.split(/\s+/);
  if (tokens.length <= 1) return ELLIPSIS;
  const keep = tokens.length === 2 ? 1 : 2;
  return `${tokens.slice(0, keep).join(' ')} ${ELLIPSIS}`;
}

function maskAccount(account: string): string {
  const digits = account.replace(/\D/g, '');
  return digits.length <= 4 ? MASK.repeat(4) : `${MASK.repeat(4)}${digits.slice(-4)}`;
}

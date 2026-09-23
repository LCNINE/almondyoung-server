import { hashVisitor, kstToday, slugify, stripPhoneSeparators } from '../shop-listing.util';

describe('slugify', () => {
  it('소문자로 바꾸고 허용 밖 문자를 하이픈 하나로 접는다', () => {
    expect(slugify('  Gangnam NAIL  Shop!! ')).toBe('gangnam-nail-shop');
  });

  it('한글은 남긴다', () => {
    expect(slugify('강남 네일샵 양도합니다')).toBe('강남-네일샵-양도합니다');
  });

  it('양 끝 하이픈을 지운다', () => {
    expect(slugify('--abc--')).toBe('abc');
  });

  it('100자로 자른다', () => {
    expect(slugify('a'.repeat(150))).toHaveLength(100);
  });

  it('남는 게 없으면 빈 문자열', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('hashVisitor', () => {
  it('같은 IP 라도 매물이 다르면 해시가 다르다 — 매물 간 방문자 대조를 막는다', () => {
    expect(hashVisitor('1.2.3.4', 'a')).not.toBe(hashVisitor('1.2.3.4', 'b'));
  });

  it('64자 hex', () => {
    expect(hashVisitor('1.2.3.4', 'a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('kstToday', () => {
  it('UTC 15:00 은 KST 다음날이다', () => {
    expect(kstToday(new Date('2026-09-23T15:00:00.000Z'))).toBe('2026-09-24');
  });

  it('UTC 14:59 는 KST 같은 날이다', () => {
    expect(kstToday(new Date('2026-09-23T14:59:59.000Z'))).toBe('2026-09-23');
  });
});

describe('stripPhoneSeparators', () => {
  it('하이픈·공백을 지운다', () => {
    expect(stripPhoneSeparators(' 010-1234 5678 ')).toBe('01012345678');
  });

  it('문자열이 아니면 그대로 둔다 — 타입 검증은 class-validator 몫이다', () => {
    expect(stripPhoneSeparators(123)).toBe(123);
    expect(stripPhoneSeparators(undefined)).toBeUndefined();
  });
});

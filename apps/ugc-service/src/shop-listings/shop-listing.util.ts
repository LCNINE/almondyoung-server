import { createHash } from 'node:crypto';

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞여 한글이 통째로 지워진다.
const SLUG_STRIP = new RegExp('[^a-z0-9\\uAC00-\\uD7A3]+', 'g');

export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(SLUG_STRIP, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** IP 를 그대로 두지 않는다. 매물 id 를 섞어 매물 간 방문자 대조도 막는다. */
export function hashVisitor(ip: string, listingId: string): string {
  return createHash('sha256').update(`${ip}|${listingId}`).digest('hex').slice(0, 64);
}

/** viewed_on 은 KST 기준 날짜다. 런타임은 UTC 라 직접 더한다. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** DTO `@Transform` 용. 문자열만 다듬고 나머지는 검증기에 넘긴다. */
export function stripPhoneSeparators(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;
}

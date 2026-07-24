import { describe, it, expect } from 'vitest';
import { errorMessage } from './errorMessage';
import { ConflictError } from './httpClient';

describe('errorMessage', () => {
  it('maps a ConflictError to a retry message', () => {
    expect(errorMessage(new ConflictError('x'))).toMatch(/먼저 변경/);
  });
  it('maps a 404 status embedded in the message', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toMatch(/찾을 수 없/);
  });
  it('maps a 500 status to a server message', () => {
    expect(errorMessage(new Error('GET /x → 500'))).toMatch(/서버/);
  });
  it('maps a 400 status to an input message', () => {
    expect(errorMessage(new Error('POST /x → 400'))).toMatch(/올바르지 않/);
  });
  it('maps 401/403 to an auth message', () => {
    expect(errorMessage(new Error('GET /x → 401'))).toMatch(/권한/);
    expect(errorMessage(new Error('GET /x → 403'))).toMatch(/권한/);
  });
  it('falls back for unknown values', () => {
    expect(errorMessage('nope')).toMatch(/알 수 없/);
  });
});

describe('errorMessage with context', () => {
  it('바코드 문맥의 404 는 미등록 바코드로 안내한다', () => {
    expect(errorMessage(new Error('GET /inventory/skus → 404'), 'barcode')).toBe(
      '등록되지 않은 바코드예요.'
    );
  });

  it('로케이션 문맥의 404 는 로케이션으로 안내한다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-location → 404'), 'location')).toBe(
      '로케이션을 찾을 수 없어요.'
    );
  });

  it('실사 문맥의 400 은 세션 상태를 짚어준다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-product → 400'), 'stocktaking')).toBe(
      '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.'
    );
  });

  it('문맥이 없으면 기존 문구를 유지한다', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toBe('찾을 수 없어요.');
    expect(errorMessage(new Error('GET /x → 400'))).toBe('요청이 올바르지 않아요.');
  });

  it('문맥이 있어도 401/403/5xx 는 공통 문구를 쓴다', () => {
    expect(errorMessage(new Error('GET /x → 403'), 'barcode')).toBe(
      '권한이 없어요. 다시 로그인해 주세요.'
    );
    expect(errorMessage(new Error('GET /x → 500'), 'stocktaking')).toBe(
      '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.'
    );
  });
});

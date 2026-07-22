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
  it('falls back for unknown values', () => {
    expect(errorMessage('nope')).toMatch(/알 수 없/);
  });
});

import { describe, it, expect } from 'vitest';
import { authHeader } from './authHeader';

describe('authHeader', () => {
  it('bearer mode', () => {
    expect(authHeader('A', 'bearer')).toEqual({ Authorization: 'Bearer A' });
  });
  it('cookie mode sets accessToken cookie', () => {
    expect(authHeader('A', 'cookie')).toEqual({ Cookie: 'accessToken=A' });
  });
});

import { describe, it, expect } from 'vitest';
import { appName } from './app/name';

describe('appName', () => {
  it('is warehouse-app', () => {
    expect(appName()).toBe('warehouse-app');
  });
});

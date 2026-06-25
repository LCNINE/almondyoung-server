import { normalizeRevokePromptValue } from './revoke-reason';

describe('normalizeRevokePromptValue', () => {
  it('keeps prompt cancellation distinct from an empty reason', () => {
    expect(normalizeRevokePromptValue(null)).toBeNull();
  });

  it('treats an empty prompt value as no reason', () => {
    expect(normalizeRevokePromptValue('')).toBeUndefined();
  });

  it('trims a provided revoke reason', () => {
    expect(normalizeRevokePromptValue('  duplicate grant  ')).toBe('duplicate grant');
  });
});

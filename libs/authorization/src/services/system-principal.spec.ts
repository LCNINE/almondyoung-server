import { isSystemPrincipal, systemPrincipal } from './system-principal';

describe('system principal', () => {
  it('recognises a principal made by the factory', () => {
    expect(isSystemPrincipal(systemPrincipal('core.fulfillment-system'))).toBe(true);
  });

  it('rejects a look-alike object and a role list', () => {
    expect(isSystemPrincipal({ name: 'core.fulfillment-system' })).toBe(false);
    expect(isSystemPrincipal({ roles: ['master'] })).toBe(false);
    expect(isSystemPrincipal(undefined)).toBe(false);
  });

  it('returns the same principal for the same name', () => {
    expect(systemPrincipal('a.b')).toBe(systemPrincipal('a.b'));
  });
});

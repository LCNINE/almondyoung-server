import { INITIAL_GRANT_ROLES, PERMISSION_CATALOG } from './permission-catalog';
import {
  directRequirements,
  missingRequirements,
  withoutDependents,
  withRequirements,
} from './permission-dependencies';

describe('permission dependencies', () => {
  it('needs the read on the same target for a write', () => {
    expect(directRequirements('order.order.write')).toEqual(['order.order.read']);
  });

  it('uses the declared requirement when the target has no read of its own', () => {
    expect(directRequirements('catalog.price.write')).toEqual(['catalog.product.read']);
  });

  it('asks nothing of a read or of a standalone permission', () => {
    expect(directRequirements('order.order.read')).toEqual([]);
    expect(directRequirements('system.oauth_client.write')).toEqual([]);
  });

  it('lists every missing pair', () => {
    expect(missingRequirements(['order.order.write', 'catalog.price.write'])).toEqual([
      { key: 'catalog.price.write', requires: 'catalog.product.read' },
      { key: 'order.order.write', requires: 'order.order.read' },
    ]);
  });

  it('adds what a permission needs when it is turned on', () => {
    expect([...withRequirements(['catalog.price.write'])].sort()).toEqual([
      'catalog.price.write',
      'catalog.product.read',
    ]);
  });

  it('turns off everything that leans on a read when the read is turned off', () => {
    const after = withoutDependents(
      ['catalog.product.read', 'catalog.product.write', 'catalog.price.write', 'order.order.read'],
      'catalog.product.read',
    );
    expect([...after].sort()).toEqual(['order.order.read']);
  });

  it('leaves an unrelated old gap alone when turning a read off', () => {
    const after = withoutDependents(
      ['catalog.price.write', 'order.order.read', 'order.order.write'],
      'order.order.read',
    );
    expect([...after]).toEqual(['catalog.price.write']);
  });

  it('only declares reads that exist as requirements', () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    const bad = PERMISSION_CATALOG.flatMap((p) =>
      directRequirements(p.key)
        .filter((r) => !r.endsWith('.read') || !keys.has(r))
        .map((r) => `${p.key} -> ${r}`),
    );
    expect(bad).toEqual([]);
  });

  it('gives every non-read permission a requirement unless it is marked standalone', () => {
    const open = PERMISSION_CATALOG.filter(
      (p) => !p.key.endsWith('.read') && !p.systemOnly && !p.standalone && directRequirements(p.key).length === 0,
    ).map((p) => p.key);
    expect(open).toEqual([]);
  });

  it('marks nothing standalone that already has a requirement', () => {
    const both = PERMISSION_CATALOG.filter((p) => p.standalone && directRequirements(p.key).length > 0).map(
      (p) => p.key,
    );
    expect(both).toEqual([]);
  });

  it('keeps every initial grant closed under its requirements', () => {
    for (const role of INITIAL_GRANT_ROLES) {
      const granted = PERMISSION_CATALOG.filter((p) => p.grantOnFirstRegistration.some((r) => r === role)).map(
        (p) => p.key,
      );
      expect({ role, missing: missingRequirements(granted) }).toEqual({ role, missing: [] });
    }
  });
});

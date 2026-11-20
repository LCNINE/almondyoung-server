import { preflightProblems, REQUIRED_PERMISSIONS } from './preflight';

describe('preflightProblems', () => {
  it('passes with all permissions and discrete', () => {
    expect(
      preflightProblems({ permissions: [...REQUIRED_PERMISSIONS], supportedPickingStrategies: ['discrete'] }),
    ).toEqual([]);
  });

  it('requires the warehouse read permission the preflight call itself needs', () => {
    // GET inventory/warehouses/:id 는 inventory.stock.read (warehouse.controller.ts)
    expect(REQUIRED_PERMISSIONS).toContain('inventory.stock.read');
  });

  it('names each missing permission', () => {
    const problems = preflightProblems({
      permissions: REQUIRED_PERMISSIONS.filter((p) => p !== 'fulfillment.dispatch.force'),
      supportedPickingStrategies: ['discrete'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fulfillment.dispatch.force');
  });

  it('reports the missing permission when the warehouse could not be read', () => {
    const problems = preflightProblems({
      permissions: REQUIRED_PERMISSIONS.filter((p) => p !== 'inventory.stock.read'),
      supportedPickingStrategies: null,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('inventory.stock.read');
  });

  it('refuses a warehouse without discrete', () => {
    const problems = preflightProblems({
      permissions: [...REQUIRED_PERMISSIONS],
      supportedPickingStrategies: ['aggregate_then_sort'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('낱개 피킹');
  });
});

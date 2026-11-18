import { preflightProblems, REQUIRED_PERMISSIONS } from './preflight';

describe('preflightProblems', () => {
  it('passes with all permissions and discrete', () => {
    expect(
      preflightProblems({ permissions: [...REQUIRED_PERMISSIONS], supportedPickingStrategies: ['discrete'] }),
    ).toEqual([]);
  });

  it('names each missing permission', () => {
    const problems = preflightProblems({
      permissions: REQUIRED_PERMISSIONS.filter((p) => p !== 'fulfillment.dispatch.force'),
      supportedPickingStrategies: ['discrete'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fulfillment.dispatch.force');
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

import { selectDemoSeedGroups } from './demo-seed-groups';

describe('demo seed group selection', () => {
  const available = ['baseline', 'demo-salon', 'demo-logistics'];
  it('honors an explicit group without seeding unrelated sample users', () => {
    expect(selectDemoSeedGroups(available, 'demo', 'demo-logistics')).toEqual(['demo-logistics']);
  });
  it('defaults the deployed demo stage to logistics only', () => {
    expect(selectDemoSeedGroups(available, 'demo')).toEqual(['demo-logistics']);
  });
  it('preserves development all-demo selection and rejects invalid requests', () => {
    expect(selectDemoSeedGroups(available, 'dev')).toEqual(['demo-salon', 'demo-logistics']);
    expect(() => selectDemoSeedGroups(available, 'demo', 'baseline')).toThrow();
    expect(() => selectDemoSeedGroups(available, 'demo', 'unknown')).toThrow();
  });
});

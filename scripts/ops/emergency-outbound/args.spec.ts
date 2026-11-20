import { parseArgs } from './args';

const NOW = new Date('2026-11-18T23:30:00Z');

describe('parseArgs', () => {
  it('requires --stage', () => {
    expect(() => parseArgs(['prepare', '--warehouse', 'w1'], NOW)).toThrow(/--stage/);
  });

  it('rejects an unknown stage', () => {
    expect(() => parseArgs(['prepare', '--stage', 'dev', '--warehouse', 'w1'], NOW)).toThrow(/--stage/);
  });

  it('defaults run to KST yyyyMMdd-HHmm', () => {
    const c = parseArgs(['prepare', '--stage', 'live', '--warehouse', 'w1'], NOW);
    expect(c).toEqual({ cmd: 'prepare', stage: 'live', warehouseId: 'w1', run: '20261119-0830', apply: false });
  });

  it('requires --warehouse for prepare', () => {
    expect(() => parseArgs(['prepare', '--stage', 'live'], NOW)).toThrow(/--warehouse/);
  });

  it('requires --run for dispatch', () => {
    expect(() => parseArgs(['dispatch', '--stage', 'live'], NOW)).toThrow(/--run/);
  });

  it('defaults csv to the run folder', () => {
    const c = parseArgs(['dispatch', '--stage', 'local', '--run', 'r1', '--apply'], NOW);
    expect(c).toEqual({
      cmd: 'dispatch',
      stage: 'local',
      run: 'r1',
      csv: '.scratch/emergency-outbound/r1/shipments.csv',
      apply: true,
    });
  });

  it('takes an explicit csv', () => {
    const c = parseArgs(['dispatch', '--stage', 'live', '--run', 'r1', '--csv', 'x.csv'], NOW);
    expect(c).toMatchObject({ csv: 'x.csv', apply: false });
  });

  it('rejects an unknown command', () => {
    expect(() => parseArgs(['nope', '--stage', 'live'], NOW)).toThrow(/사용법/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['prepare', '--stage', 'live', '--warehouse', 'w1', '--force'], NOW)).toThrow(/--force/);
  });
});

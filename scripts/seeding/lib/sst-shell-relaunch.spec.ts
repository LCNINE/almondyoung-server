import { getSstShellEnvironment, parseCommonArgs } from './sst-shell-relaunch';

describe('demo infrastructure-only SST relaunch', () => {
  it('parses the explicit infrastructure-only option', () => {
    expect(
      parseCommonArgs(['node', 'bootstrap.ts', '--stage', 'demo', '--deployment', 'lcnine-services', '--infra-only']),
    ).toMatchObject({ stage: 'demo', deployment: 'lcnine-services', infraOnly: true });
  });

  it('sets DEMO_INFRA_ONLY before SST evaluates the demo config', () => {
    expect(getSstShellEnvironment({ stage: 'demo', infraOnly: true }, { PATH: '/bin' })).toEqual({
      PATH: '/bin',
      DEMO_INFRA_ONLY: 'true',
    });
  });

  it('rejects infrastructure-only mode for non-demo stages', () => {
    expect(() => getSstShellEnvironment({ stage: 'dev', infraOnly: true }, {})).toThrow(
      '--infra-only is only valid with --stage demo',
    );
  });
});

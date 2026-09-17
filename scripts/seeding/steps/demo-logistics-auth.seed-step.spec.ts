import { validateSync } from 'class-validator';
import { SignInDto } from '../../../apps/user-service/src/api/auth/dto/sign-in.dto';
import { DEMO_AUTH_ACCOUNTS, DemoLogisticsAuthSeedStep } from './demo-logistics-auth.seed-step';

describe('logistics demo account seed boundary', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });
  it('refuses non-demo and conflicting stage context before opening a DB connection', async () => {
    process.env = { ...env, SST_STAGE: 'live' };
    const step = new DemoLogisticsAuthSeedStep('postgresql://localhost/unreachable');
    await expect(step.apply()).rejects.toThrow('demo');
    process.env = { ...env, SST_STAGE: 'demo', SST_RESOURCE_App: JSON.stringify({ stage: 'live' }) };
    await expect(step.apply()).rejects.toThrow('demo');
    await step.dispose();
  });
  it('uses account names accepted by the actual sign-in DTO and keeps worker privileges narrow', () => {
    for (const account of DEMO_AUTH_ACCOUNTS) {
      expect(
        validateSync(Object.assign(new SignInDto(), { loginId: account.login, password: 'Demo-valid-pass-1234' })),
      ).toEqual([]);
    }
    expect(DEMO_AUTH_ACCOUNTS[1].roles).toHaveLength(1);
    expect(DEMO_AUTH_ACCOUNTS[0].roles).not.toEqual(DEMO_AUTH_ACCOUNTS[1].roles);
  });
  it('rejects generated passwords longer than the actual sign-in limit', async () => {
    process.env = {
      SST_STAGE: 'demo',
      DEMO_ADMIN_PASSWORD: 'a'.repeat(48),
      DEMO_WORKER_PASSWORD: 'b'.repeat(20),
      ADMIN_WEB_OIDC_CLIENT_SECRET: 'c'.repeat(48),
    };
    const step = new DemoLogisticsAuthSeedStep('postgresql://localhost/unreachable');
    await expect(step.apply()).rejects.toThrow('20 characters');
    await step.dispose();
  });
  it('requires supplied strong account passwords and RP secret', async () => {
    process.env = { SST_STAGE: 'demo' };
    const step = new DemoLogisticsAuthSeedStep('postgresql://localhost/unreachable');
    await expect(step.apply()).rejects.toThrow('DEMO_ADMIN_PASSWORD');
    await step.dispose();
  });
});

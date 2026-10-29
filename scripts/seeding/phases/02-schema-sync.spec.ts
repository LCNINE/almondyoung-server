import { execSync } from 'child_process';
import { runSchemaSync, SchemaSyncError } from './02-schema-sync';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
// ts-jest 는 esModuleInterop 없이 돌아 `import chalk from 'chalk'` 가 undefined 다.
jest.mock('chalk', () => {
  const identity: unknown = new Proxy((text: string) => text, { get: () => identity });
  return { __esModule: true, default: identity };
});
jest.mock('../lib/service-registry', () => ({
  getServiceRegistry: () => [
    { name: 'core', database: 'core', drizzleConfig: 'apps/core/drizzle.config.ts' },
    { name: 'medusa', database: 'medusa' },
    { name: 'wallet', database: 'wallet', drizzleConfig: 'apps/wallet/drizzle.config.ts' },
  ],
}));
jest.mock('../lib/db-connection', () => ({ buildDatabaseUrl: (db: string) => `postgres://localhost/${db}` }));

const execSyncMock = jest.mocked(execSync);

describe('runSchemaSync', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns every drizzle service when all migrations succeed', async () => {
    await expect(runSchemaSync({ yes: true })).resolves.toEqual(['core', 'wallet']);
  });

  // db:migrate 는 배포 절차에서 사람이 부른다. 실패가 exit 0 으로 끝나면 마이그가 빠진 채 배포된다.
  it('rejects after trying the rest when one migration fails', async () => {
    execSyncMock.mockImplementation((command) => {
      if (String(command).includes('apps/core/')) throw new Error('relation already exists');
      return Buffer.from('');
    });

    const result = runSchemaSync({ yes: true });

    await expect(result).rejects.toBeInstanceOf(SchemaSyncError);
    await expect(result).rejects.toMatchObject({ failed: ['core'], synced: ['wallet'] });
    expect(execSyncMock).toHaveBeenCalledTimes(2);
  });
});

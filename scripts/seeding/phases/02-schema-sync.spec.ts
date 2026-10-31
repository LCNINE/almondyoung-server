import { execSync } from 'child_process';
import { runSchemaSync, SchemaSyncError } from './02-schema-sync';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
// ts-jest 는 esModuleInterop 없이 돌아 `import chalk from 'chalk'` 가 undefined 다.
jest.mock('chalk', () => {
  const identity: unknown = new Proxy((text: string) => text, { get: () => identity });
  return { __esModule: true, default: identity };
});
// 테넌트 목록에 둘 — core 가 테넌트 DB 마다 한 줄로 펼쳐진 레지스트리
jest.mock('../lib/tenant-registry', () => ({
  resolveRegistry: () => [
    {
      name: 'core',
      database: 'core',
      drizzleConfig: 'apps/core/drizzle.config.ts',
      tenant: { tenantId: '1', slug: 'one', database: 'core', tenantOneData: true },
    },
    {
      name: 'core',
      database: 'core_two',
      drizzleConfig: 'apps/core/drizzle.config.ts',
      tenant: { tenantId: '2', slug: 'two', database: 'core_two', tenantOneData: false },
    },
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

  it('core 를 테넌트 DB 마다 한 번씩 적용한다', async () => {
    await expect(runSchemaSync({ yes: true })).resolves.toEqual(['core(테넌트 1)', 'core(테넌트 2)', 'wallet']);
    const urls = execSyncMock.mock.calls.map(([, opts]) => opts?.env?.DATABASE_URL);
    expect(urls).toEqual(['postgres://localhost/core', 'postgres://localhost/core_two', 'postgres://localhost/wallet']);
  });

  // db:migrate 는 배포 절차에서 사람이 부른다. 실패가 exit 0 으로 끝나면 마이그가 빠진 채 배포된다.
  it('rejects after trying the rest when one migration fails', async () => {
    execSyncMock.mockImplementation((command) => {
      if (String(command).includes('apps/wallet/')) throw new Error('relation already exists');
      return Buffer.from('');
    });

    const result = runSchemaSync({ yes: true });

    await expect(result).rejects.toBeInstanceOf(SchemaSyncError);
    await expect(result).rejects.toMatchObject({ failed: ['wallet'], synced: ['core(테넌트 1)', 'core(테넌트 2)'] });
    expect(execSyncMock).toHaveBeenCalledTimes(3);
  });

  // 테넌트 하나만 실패해도 0 이 아닌 코드여야 한다 — 「일부 테넌트만 새 버전」은 배포 조건 위반이다.
  it('테넌트 DB 하나만 실패해도 거절한다', async () => {
    execSyncMock.mockImplementation((_command, opts) => {
      if (opts?.env?.DATABASE_URL === 'postgres://localhost/core_two') throw new Error('lock timeout');
      return Buffer.from('');
    });

    await expect(runSchemaSync({ yes: true })).rejects.toMatchObject({
      failed: ['core(테넌트 2)'],
      synced: ['core(테넌트 1)', 'wallet'],
    });
  });
});

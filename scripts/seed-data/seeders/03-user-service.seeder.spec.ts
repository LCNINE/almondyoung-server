import { PgDialect } from 'drizzle-orm/pg-core';

const execute = jest.fn().mockResolvedValue(undefined);

jest.mock('../shared/logger', () => ({
  Logger: jest.fn(() => ({ info: jest.fn(), step: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));
jest.mock('postgres', () => ({
  __esModule: true,
  default: jest.fn(() => ({ end: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: jest.fn(() => ({ execute })) }));

import { seedUserService } from './03-user-service.seeder';

describe('user-service reference seeder', () => {
  it('sends no statement that touches the legacy scope tables', async () => {
    execute.mockClear();
    await seedUserService('postgres://unused', 'seed-test-password', {
      oauthClients: [{ clientId: 'c', clientType: 'public', redirectUris: ['https://x.test/cb'] }],
    });

    const dialect = new PgDialect();
    const statements = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql);
    expect(statements.some((text) => /insert into roles/i.test(text))).toBe(true);
    expect(statements.filter((text) => /auth\.scopes|role_scope_mapping/i.test(text))).toEqual([]);
  });
});

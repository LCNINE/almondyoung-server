import * as bcrypt from 'bcrypt';
import {
  OAuthClientAlreadyExistsException,
  OAuthClientNotFoundException,
} from './exceptions/oauth-clients.exceptions';
import { OAuthClientsManager } from './oauth-clients.manager';
import { OAuthClientsReader } from './oauth-clients.reader';
import { OAuthClientRow, OAuthClientsRepository } from './oauth-clients.repository';

function makeRow(overrides: Partial<OAuthClientRow> = {}): OAuthClientRow {
  return {
    clientId: 'daview',
    clientType: 'confidential',
    clientSecretHash: 'hash-current',
    previousSecretHash: null,
    secretRotatedAt: null,
    redirectUris: ['https://daview.com/auth/callback'],
    postLogoutRedirectUris: null,
    allowedScopes: null,
    isActive: true,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OAuthClientsManager', () => {
  let repo: jest.Mocked<OAuthClientsRepository>;
  let reader: OAuthClientsReader;
  let manager: OAuthClientsManager;

  beforeEach(() => {
    repo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      rotateSecret: jest.fn(),
      clearPreviousSecret: jest.fn(),
    } as unknown as jest.Mocked<OAuthClientsRepository>;
    reader = new OAuthClientsReader(repo);
    manager = new OAuthClientsManager(repo, reader);
  });

  describe('createClient', () => {
    it('중복 clientId 면 예외', async () => {
      repo.findById.mockResolvedValueOnce(makeRow());
      await expect(
        manager.createClient({ clientId: 'daview', redirectUris: ['https://x'] }),
      ).rejects.toBeInstanceOf(OAuthClientAlreadyExistsException);
    });

    it('정상 생성: secret 생성 + bcrypt 해시 + raw secret 1회 반환', async () => {
      repo.findById.mockResolvedValueOnce(null);
      repo.create.mockImplementationOnce(async (input) =>
        makeRow({ clientId: input.clientId, clientSecretHash: input.clientSecretHash, redirectUris: input.redirectUris }),
      );
      const result = await manager.createClient({
        clientId: 'daview',
        redirectUris: ['https://daview.com/cb'],
      });
      expect(result.clientSecret).toBeDefined();
      expect(result.clientSecret).not.toBeNull();
      expect(result.clientSecret!.length).toBeGreaterThan(20);
      const passed = repo.create.mock.calls[0][0];
      expect(passed.clientType).toBe('confidential');
      expect(passed.clientSecretHash).not.toBe(result.clientSecret);
      await expect(bcrypt.compare(result.clientSecret!, passed.clientSecretHash)).resolves.toBe(true);
    });

    it('public client: clientSecret null + 검증 불가능한 해시 저장', async () => {
      repo.findById.mockResolvedValueOnce(null);
      repo.create.mockImplementationOnce(async (input) =>
        makeRow({
          clientId: input.clientId,
          clientType: input.clientType,
          clientSecretHash: input.clientSecretHash,
          redirectUris: input.redirectUris,
        }),
      );
      const result = await manager.createClient({
        clientId: 'spa-app',
        clientType: 'public',
        redirectUris: ['http://127.0.0.1/callback'],
      });
      expect(result.clientSecret).toBeNull();
      expect(result.clientType).toBe('public');
      const passed = repo.create.mock.calls[0][0];
      expect(passed.clientType).toBe('public');
      expect(passed.clientSecretHash).toMatch(/^\$2[aby]\$/); // bcrypt hash
    });
  });

  describe('rotateSecret', () => {
    it('현재 hash 를 previous 로 옮기고 새 secret 반환', async () => {
      const current = makeRow({ clientSecretHash: 'hash-old' });
      repo.findById.mockResolvedValueOnce(current);
      repo.rotateSecret.mockImplementationOnce(async (clientId, prev, next) =>
        makeRow({
          clientId,
          previousSecretHash: prev,
          clientSecretHash: next,
          secretRotatedAt: new Date(),
        }),
      );
      const result = await manager.rotateSecret('daview');
      expect(repo.rotateSecret).toHaveBeenCalledWith('daview', 'hash-old', expect.any(String));
      expect(result.hasPreviousSecret).toBe(true);
      expect(result.clientSecret).toBeDefined();
    });

    it('미존재 clientId 면 NotFound', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(manager.rotateSecret('ghost')).rejects.toBeInstanceOf(OAuthClientNotFoundException);
    });

    it('public client는 회전 불가', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ clientType: 'public' }));
      await expect(manager.rotateSecret('daview')).rejects.toThrow(/public client/);
    });
  });

  describe('deactivateClient', () => {
    it('isActive=false / deactivatedAt 설정', async () => {
      repo.findById.mockResolvedValueOnce(makeRow());
      repo.update.mockImplementationOnce(async (id, patch) =>
        makeRow({ clientId: id, isActive: patch.isActive ?? true, deactivatedAt: patch.deactivatedAt ?? null }),
      );
      const result = await manager.deactivateClient('daview');
      expect(result.isActive).toBe(false);
      expect(result.deactivatedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateClient', () => {
    it('allowedScopes 빈 배열 → null 로 정규화', async () => {
      repo.findById.mockResolvedValueOnce(makeRow());
      repo.update.mockImplementationOnce(async (_id, patch) => makeRow({ allowedScopes: patch.allowedScopes ?? null }));
      const result = await manager.updateClient('daview', { allowedScopes: [] });
      expect(repo.update).toHaveBeenCalledWith('daview', expect.objectContaining({ allowedScopes: null }));
      expect(result.allowedScopes).toBeNull();
    });
  });
});

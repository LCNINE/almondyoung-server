import { BadRequestError } from '@app/shared';
import * as bcrypt from 'bcrypt';
import {
  OAuthClientAlreadyExistsException,
  OAuthClientNotFoundException,
} from './exceptions/oauth-clients.exceptions';
import { PublicClientOriginsCache } from '../../oauth/cors/public-client-origins.cache';
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
    tenantId: '1',
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
  let publicClientOrigins: { invalidate: jest.Mock };
  let manager: OAuthClientsManager;

  beforeEach(() => {
    repo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      rotateSecret: jest.fn(),
      clearPreviousSecret: jest.fn(),
      tenantExists: jest.fn().mockResolvedValue(true),
      // 기본: 모든 host 가 테넌트 도메인이다.
      hostsWithoutTenant: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OAuthClientsRepository>;
    reader = new OAuthClientsReader(repo);
    publicClientOrigins = { invalidate: jest.fn() };
    manager = new OAuthClientsManager(repo, reader, publicClientOrigins as unknown as PublicClientOriginsCache);
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

    it('고정 테넌트를 주면 그대로 저장하고, 안 주면 비운다(웹 직원 앱 — 리디렉트 host 가 테넌트를 정한다)', async () => {
      repo.findById.mockResolvedValue(null);
      repo.create.mockImplementation(async (input) => makeRow({ tenantId: input.tenantId }));

      const fixed = await manager.createClient({ clientId: 'shop', redirectUris: ['https://shop/cb'], tenantId: '2' });
      const staffWeb = await manager.createClient({ clientId: 'staff', redirectUris: ['https://admin/cb'] });

      expect(repo.create.mock.calls[0][0].tenantId).toBe('2');
      expect(fixed.tenantId).toBe('2');
      expect(repo.create.mock.calls[1][0].tenantId).toBeNull();
      expect(staffWeb.tenantId).toBeNull();
    });

    it('웹 직원 앱(고정 테넌트 없음)의 리디렉트 host 가 테넌트 도메인이 아니면 400 — 그 주소로는 로그인이 안 되므로', async () => {
      repo.findById.mockResolvedValue(null);
      repo.hostsWithoutTenant.mockResolvedValue(['elsewhere.test']);

      await expect(
        manager.createClient({ clientId: 'staff', redirectUris: ['https://elsewhere.test/cb'] }),
      ).rejects.toThrow(/elsewhere\.test/);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('고정 테넌트 앱은 리디렉트 host 를 테넌트 도메인과 대조하지 않는다', async () => {
      repo.findById.mockResolvedValue(null);
      repo.hostsWithoutTenant.mockResolvedValue(['shop.test']);
      repo.create.mockImplementation(async (input) => makeRow({ tenantId: input.tenantId }));

      await manager.createClient({ clientId: 'shop', redirectUris: ['https://shop.test/cb'], tenantId: '1' });

      expect(repo.create).toHaveBeenCalled();
    });

    it('없는 테넌트를 고정 테넌트로 주면 400 이고 만들지 않는다', async () => {
      repo.findById.mockResolvedValue(null);
      repo.tenantExists.mockResolvedValue(false);

      await expect(
        manager.createClient({ clientId: 'shop', redirectUris: ['https://shop/cb'], tenantId: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(repo.create).not.toHaveBeenCalled();
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
      // 비활성 공개 클라이언트의 origin 이 CORS 캐시에 TTL 동안 남지 않게 한다.
      expect(publicClientOrigins.invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateClient', () => {
    it('allowedScopes 빈 배열 → null 로 정규화', async () => {
      repo.findById.mockResolvedValueOnce(makeRow());
      repo.update.mockImplementationOnce(async (_id, patch) => makeRow({ allowedScopes: patch.allowedScopes ?? null }));
      const result = await manager.updateClient('daview', { allowedScopes: [] });
      expect(repo.update).toHaveBeenCalledWith('daview', expect.objectContaining({ allowedScopes: null }));
      expect(result.allowedScopes).toBeNull();
      expect(publicClientOrigins.invalidate).toHaveBeenCalledTimes(1);
    });

    it('웹 직원 앱에 테넌트 도메인이 아닌 리디렉트를 더하면 400 이고 바꾸지 않는다', async () => {
      repo.findById.mockResolvedValue(makeRow({ clientId: 'admin-web', tenantId: null }));
      repo.hostsWithoutTenant.mockResolvedValue(['new-admin.test']);

      await expect(
        manager.updateClient('admin-web', { redirectUris: ['https://new-admin.test/auth/callback'] }),
      ).rejects.toThrow(/new-admin\.test/);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});

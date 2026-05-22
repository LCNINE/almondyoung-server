import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationService } from '@app/authorization';
import { NotFoundError, ForbiddenError } from '@app/shared';
import { FileAccess } from './file-access';
import { FileRepository } from '../shared/repositories/file.repository';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

describe('FileAccess', () => {
  let fileAccess: FileAccess;
  let repo: jest.Mocked<FileRepository>;
  let authorization: jest.Mocked<AuthorizationService>;

  const ownerUser: JwtPayload = { userId: 'owner-1', email: 'o@x', roles: [] };
  const otherUser: JwtPayload = { userId: 'other-1', email: 'oo@x', roles: [] };
  const masterUser: JwtPayload = { userId: 'master-1', email: 'm@x', roles: ['master'] };
  // Service-to-service 위임 토큰 (예: core 의 FileServiceClient): roles 없이 scopes 만.
  const serviceTokenUser: JwtPayload = { userId: 'core-library-service', email: '', roles: [], scopes: ['master'] };

  const baseFile = {
    id: 'file-1',
    fileName: 'a.png',
    originalName: 'a.png',
    mimeType: 'image/png',
    size: 100,
    filePath: 'path/a.png',
    url: 'https://example/a.png',
    storageProvider: 's3',
    status: 'active',
    metadata: null,
    uploadedBy: 'owner-1',
    isPublic: false,
    contextId: 'ctx-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    activatedAt: new Date(),
    deletedAt: null,
  } as unknown as Upload;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileAccess,
        {
          provide: FileRepository,
          useValue: { findById: jest.fn(), softDelete: jest.fn() },
        },
        {
          provide: AuthorizationService,
          useValue: { hasScope: jest.fn() },
        },
      ],
    }).compile();

    fileAccess = module.get(FileAccess);
    repo = module.get(FileRepository) as jest.Mocked<FileRepository>;
    authorization = module.get(AuthorizationService) as jest.Mocked<AuthorizationService>;

    authorization.hasScope.mockImplementation(async (user: JwtPayload, scope: string) =>
      (user.roles ?? []).includes(scope),
    );
  });

  describe('loadReadable', () => {
    it('throws NotFoundError when file does not exist', async () => {
      repo.findById.mockResolvedValue(undefined as unknown as Upload);
      await expect(fileAccess.loadReadable('missing', ownerUser)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when file is deleted', async () => {
      repo.findById.mockResolvedValue({ ...baseFile, status: 'deleted' } as Upload);
      await expect(fileAccess.loadReadable('file-1', ownerUser)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns public file to any user', async () => {
      repo.findById.mockResolvedValue({ ...baseFile, isPublic: true } as Upload);
      await expect(fileAccess.loadReadable('file-1', otherUser)).resolves.toMatchObject({ id: 'file-1' });
    });

    it('returns private file to owner', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.loadReadable('file-1', ownerUser)).resolves.toMatchObject({ id: 'file-1' });
    });

    it('returns private file to master scope holder', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.loadReadable('file-1', masterUser)).resolves.toMatchObject({ id: 'file-1' });
    });

    it('returns private file to service token (scopes-only, no roles)', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.loadReadable('file-1', serviceTokenUser)).resolves.toMatchObject({ id: 'file-1' });
    });

    it('throws ForbiddenError when private file requested by non-owner non-master', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.loadReadable('file-1', otherUser)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('loadPublicServable', () => {
    it('throws NotFoundError when file does not exist', async () => {
      repo.findById.mockResolvedValue(undefined as unknown as Upload);
      await expect(fileAccess.loadPublicServable('missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when file is private', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.loadPublicServable('file-1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when file is deleted', async () => {
      repo.findById.mockResolvedValue({ ...baseFile, isPublic: true, status: 'deleted' } as Upload);
      await expect(fileAccess.loadPublicServable('file-1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns active public file', async () => {
      repo.findById.mockResolvedValue({ ...baseFile, isPublic: true } as Upload);
      await expect(fileAccess.loadPublicServable('file-1')).resolves.toMatchObject({ id: 'file-1' });
    });
  });

  describe('delete', () => {
    it('throws NotFoundError when file does not exist', async () => {
      repo.findById.mockResolvedValue(undefined as unknown as Upload);
      await expect(fileAccess.delete('missing', ownerUser)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when file is already deleted', async () => {
      repo.findById.mockResolvedValue({ ...baseFile, status: 'deleted' } as Upload);
      await expect(fileAccess.delete('file-1', ownerUser)).rejects.toBeInstanceOf(NotFoundError);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes when called by owner', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.delete('file-1', ownerUser)).resolves.toMatchObject({ success: true });
      expect(repo.softDelete).toHaveBeenCalledWith('file-1');
    });

    it('soft-deletes when called by master scope holder', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.delete('file-1', masterUser)).resolves.toMatchObject({ success: true });
      expect(repo.softDelete).toHaveBeenCalledWith('file-1');
    });

    it('soft-deletes when called via service token (scopes-only)', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.delete('file-1', serviceTokenUser)).resolves.toMatchObject({ success: true });
      expect(repo.softDelete).toHaveBeenCalledWith('file-1');
    });

    it('throws ForbiddenError when caller is neither owner nor master', async () => {
      repo.findById.mockResolvedValue(baseFile);
      await expect(fileAccess.delete('file-1', otherUser)).rejects.toBeInstanceOf(ForbiddenError);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});

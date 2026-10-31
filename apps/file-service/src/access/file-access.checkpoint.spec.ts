import { createCheckpointsForTesting, PermissionCheckpoints } from '@app/authorization';
import { ForbiddenError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { DIGITAL_ASSET_FILE_CONTEXT_ID } from '../database/default-file-contexts';
import { FileRepository } from '../shared/repositories/file.repository';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import { FileAccess } from './file-access';

const file: Upload = {
  id: 'f-1',
  fileName: 'a.zip',
  originalName: 'a.zip',
  mimeType: 'application/zip',
  size: 100,
  filePath: 'path/a.zip',
  url: 'https://example/a.zip',
  storageProvider: 's3',
  status: 'active',
  contextId: DIGITAL_ASSET_FILE_CONTEXT_ID,
  metadata: null,
  uploadedBy: 'owner',
  isPublic: false,
  tenantId: '1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  activatedAt: new Date('2026-10-01T00:00:00Z'),
};

const user = (userId: string, roles: string[], scopes?: string[]): JwtPayload => ({ userId, email: '', roles, scopes });

async function access(
  byRole: Readonly<Record<string, readonly string[]>> | null = {
    admin: ['catalog.product.read'],
    intern: ['catalog.product.read'],
    logistics_worker: [],
  },
): Promise<FileAccess> {
  const module = await Test.createTestingModule({
    providers: [
      FileAccess,
      { provide: FileRepository, useValue: { findById: jest.fn(async () => file), softDelete: jest.fn() } },
      { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting(byRole) },
    ],
  }).compile();
  return module.get(FileAccess);
}

describe('FileAccess permission checkpoints', () => {
  it('opens a staff context to whoever holds that screen permission', async () => {
    const files = await access();
    await expect(files.loadReadable('f-1', user('a', ['admin']), '1')).resolves.toBe(file);
    await expect(files.loadReadable('f-1', user('i', ['intern']), '1')).resolves.toBe(file);
    await expect(files.loadReadable('f-1', user('w', ['logistics_worker']), '1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('does not open a file by an old role name alone', async () => {
    const files = await access({ master: [], admin: [] });
    await expect(files.loadReadable('f-1', user('m', ['master']), '1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(files.loadReadable('f-1', user('a', ['admin']), '1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(files.delete('f-1', user('m', ['master']), '1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets the file management permission open and delete files it does not own', async () => {
    const files = await access({ file_keeper: ['system.file.manage'] });
    await expect(files.loadReadable('f-1', user('k', ['file_keeper']), '1')).resolves.toBe(file);
    await expect(files.delete('f-1', user('k', ['file_keeper']), '1')).resolves.toMatchObject({ success: true });
  });

  it('no longer treats the retired master-scope token as a system principal', async () => {
    const files = await access(null);
    await expect(files.loadReadable('f-1', user('core-library-service', [], ['master']), '1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('sees a standard delegation token from core or ugc as a system principal', async () => {
    const files = await access(null);
    const onBehalf: JwtPayload = { userId: 'u1', email: '', roles: [], act: { sub: 'core' }, aud: 'file-service' };
    const serviceOnly: JwtPayload = {
      userId: 'svc',
      email: '',
      roles: [],
      client_id: 'ugc-service',
      aud: 'file-service',
    };
    await expect(files.loadReadable('f-1', onBehalf, '1')).resolves.toBe(file);
    await expect(files.delete('f-1', serviceOnly, '1')).resolves.toMatchObject({ success: true });
  });

  it('does not treat a delegation token addressed to another service as a system principal', async () => {
    const files = await access(null);
    const elsewhere: JwtPayload = { userId: 'u1', email: '', roles: [], act: { sub: 'core' }, aud: 'core' };
    await expect(files.loadReadable('f-1', elsewhere, '1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies non-owners before the permission copy arrives', async () => {
    const files = await access(null);
    await expect(files.loadReadable('f-1', user('m', ['master']), '1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets the owner in without any permission', async () => {
    const files = await access({});
    await expect(files.loadReadable('f-1', user('owner', ['logistics_worker']), '1')).resolves.toBe(file);
  });
});

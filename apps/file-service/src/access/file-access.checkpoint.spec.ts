import {
  AuthorizationService,
  checkpointEvaluations,
  createCheckpointsForTesting,
  PermissionCheckpoints,
} from '@app/authorization';
import { ForbiddenError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { register } from 'prom-client';
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
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  activatedAt: new Date('2026-10-01T00:00:00Z'),
};

const user = (userId: string, roles: string[], scopes?: string[]): JwtPayload => ({ userId, email: '', roles, scopes });

async function access(): Promise<FileAccess> {
  const module = await Test.createTestingModule({
    providers: [
      FileAccess,
      { provide: FileRepository, useValue: { findById: jest.fn(async () => file), softDelete: jest.fn() } },
      { provide: AuthorizationService, useValue: { hasScope: jest.fn(async () => false) } },
      {
        provide: PermissionCheckpoints,
        useValue: createCheckpointsForTesting({
          admin: ['catalog.product.read'],
          intern: ['catalog.product.read'],
          logistics_worker: [],
        }),
      },
    ],
  }).compile();
  return module.get(FileAccess);
}

describe('FileAccess permission comparison', () => {
  beforeEach(() => register.resetMetrics());

  it('compares the staff context rule with the screen permission of that context', async () => {
    const files = await access();
    await expect(files.loadReadable('f-1', user('a', ['admin']))).resolves.toBe(file);
    await expect(files.loadReadable('f-1', user('i', ['intern']))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await checkpointEvaluations('file.staff_context_read', 'match')).toBe(1);
    expect(await checkpointEvaluations('file.staff_context_read', 'would_allow')).toBe(1);
  });

  it('sees a core delegation token as a system principal', async () => {
    const files = await access();
    await expect(files.loadReadable('f-1', user('core-library-service', [], ['master']))).resolves.toBe(file);
    expect(await checkpointEvaluations('file.owner_exception', 'match')).toBe(1);
  });

  it('does not compare anything for the owner', async () => {
    const files = await access();
    await expect(files.loadReadable('f-1', user('owner', ['logistics_worker']))).resolves.toBe(file);
    for (const outcome of ['match', 'would_deny', 'would_allow', 'unavailable']) {
      expect(await checkpointEvaluations('file.owner_exception', outcome)).toBe(0);
    }
  });
});

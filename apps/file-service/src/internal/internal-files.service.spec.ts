import { InternalFilesService, OBJECT_PURGE_GRACE_DAYS } from './internal-files.service';
import type { FileRepository } from '../shared/repositories/file.repository';
import type { StorageService } from '../storage/storage.service';

const DAY = 24 * 60 * 60 * 1000;

function setup(file: Record<string, unknown> | undefined) {
  const storageDeleted: unknown[] = [];
  const hardDeleted: string[] = [];
  const softDeleted: string[] = [];
  const statusUpdates: { id: string; status: string; extra?: unknown }[] = [];

  const repo = {
    findById: () => Promise.resolve(file),
    softDelete: (id: string) => {
      softDeleted.push(id);
      return Promise.resolve(file);
    },
    hardDelete: (id: string) => {
      hardDeleted.push(id);
      return Promise.resolve();
    },
    updateStatus: (id: string, status: string, extra?: unknown) => {
      statusUpdates.push({ id, status, extra });
      return Promise.resolve(file);
    },
  } as unknown as FileRepository;

  const storage = {
    delete: (req: unknown) => {
      storageDeleted.push(req);
      return Promise.resolve();
    },
  } as unknown as StorageService;

  return { service: new InternalFilesService(repo, storage), storageDeleted, hardDeleted, softDeleted, statusUpdates };
}

const deletedFile = (deletedAt: Date) => ({
  id: 'f1',
  status: 'deleted',
  deletedAt,
  filePath: 'products/images/f1.png',
  isPublic: true,
  contextId: 'product-image',
});

describe('내부 파일 정리', () => {
  it('공모전이 확인할 수 있도록 이미지의 실제 크기를 반환한다', async () => {
    const { service } = setup({
      id: 'f1',
      contextId: 'logo-contest-image',
      uploadedBy: 'u1',
      status: 'active',
      mimeType: 'image/png',
      metadata: { width: 512, height: 512 },
    });

    await expect(service.describe('f1')).resolves.toMatchObject({ width: 512, height: 512 });
  });

  it('soft delete 는 S3 객체를 건드리지 않는다', async () => {
    const { service, storageDeleted, softDeleted } = setup({
      ...deletedFile(new Date()),
      status: 'active',
      deletedAt: null,
    });

    await service.softDelete('f1');

    expect(softDeleted).toEqual(['f1']);
    expect(storageDeleted).toEqual([]);
  });

  // 호출자가 시점을 잘못 계산해도 여기서 막혀야 한다.
  it('soft delete 되지 않은 파일은 purge 를 거부한다', async () => {
    const { service, storageDeleted } = setup({ ...deletedFile(new Date()), status: 'active', deletedAt: null });

    await expect(service.purgeObject('f1')).rejects.toThrow(/not soft-deleted/);
    expect(storageDeleted).toEqual([]);
  });

  it('유예기간 안이면 purge 를 거부한다', async () => {
    const { service, storageDeleted, hardDeleted } = setup(deletedFile(new Date(Date.now() - 1 * DAY)));

    await expect(service.purgeObject('f1')).rejects.toThrow(/grace period/);
    expect(storageDeleted).toEqual([]);
    expect(hardDeleted).toEqual([]);
  });

  it('복구는 status 를 active 로 되돌리고 deleted_at 을 비운다', async () => {
    const { service, statusUpdates, storageDeleted } = setup(deletedFile(new Date()));

    await service.restore('f1');

    expect(statusUpdates).toEqual([{ id: 'f1', status: 'active', extra: { deletedAt: null } }]);
    expect(storageDeleted).toEqual([]);
  });

  it('유예가 지나면 S3 객체와 행을 지운다', async () => {
    const past = new Date(Date.now() - (OBJECT_PURGE_GRACE_DAYS + 1) * DAY);
    const { service, storageDeleted, hardDeleted } = setup(deletedFile(past));

    await service.purgeObject('f1');

    expect(storageDeleted).toEqual([{ key: 'products/images/f1.png', isPublic: true }]);
    expect(hardDeleted).toEqual(['f1']);
  });
});

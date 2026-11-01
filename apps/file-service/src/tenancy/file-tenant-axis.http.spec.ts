import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as request from 'supertest';
import {
  createCheckpointsForTesting,
  INTERNAL_KEY_ENV,
  IS_PUBLIC_KEY,
  PermissionCheckpoints,
} from '@app/authorization';
import { GlobalExceptionFilter } from '@app/shared';
import { parseTenantList, TenancyConfig, TENANT_HEADER, type TenantGateMode } from '@app/tenancy';
import { FileAccess } from '../access/file-access';
import { FILE_CONTEXTS } from '../database/default-file-contexts';
import { DownloadController } from '../download/download.controller';
import { DownloadService } from '../download/download.service';
import { LocalFileController } from '../download/local-file.controller';
import { InternalFilesController } from '../internal/internal-files.controller';
import { InternalFilesService } from '../internal/internal-files.service';
import { LifecycleController } from '../lifecycle/lifecycle.controller';
import { FileContextRepository } from '../shared/repositories/file-context.repository';
import { FileRepository } from '../shared/repositories/file.repository';
import { FileContextValidator } from '../shared/services/file-context-validator.service';
import { FileTypeDetector } from '../shared/services/file-type-detector.service';
import { NewUpload, Upload, UpdateUpload } from '../shared/types/file.types';
import { PathBuilderService } from '../storage/path-builder.service';
import { LocalStorageProvider } from '../storage/providers/local-storage.provider';
import { S3StorageProvider } from '../storage/providers/s3-storage.provider';
import { StorageProviderRegistry } from '../storage/storage-provider.registry';
import { StorageService } from '../storage/storage.service';
import { UploadController } from '../upload/upload.controller';
import { UploadService } from '../upload/upload.service';
import { FileRequestTenantInterceptor } from './file-request-tenant.interceptor';

// 테넌트 1 은 공용 버킷 하나(ACL 로 공개·비공개), 테넌트 2 는 공개·비공개 버킷 둘. 이름은 목록에서만 온다.
const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'one-shared', privateBucket: 'one-shared' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'two-pub', privateBucket: 'two-priv' },
  ]),
);

const PNG = readFileSync(join(__dirname, '../upload/__fixtures__/logo.png'));
const PORT = '3999';
const INTERNAL_KEY = 'test-internal-key';

/** uploads 표 자리. 테넌트를 모르는 쓰기는 DB 기본값이 테넌트 1 로 채운다(backfill-upload-tenant-one 마이그). */
class MemoryFiles {
  readonly rows = new Map<string, Upload>();

  create(data: NewUpload): Promise<Upload> {
    const now = new Date();
    const row: Upload = {
      storageProvider: 's3',
      status: 'active',
      metadata: null,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      activatedAt: null,
      ...data,
      id: data.id ?? `${this.rows.size}`,
      tenantId: data.tenantId ?? '1',
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(id: string): Promise<Upload | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  updateStatus(id: string, status: string, extra?: UpdateUpload): Promise<Upload> {
    const row = { ...this.rows.get(id)!, ...extra, status };
    this.rows.set(id, row);
    return Promise.resolve(row);
  }

  softDelete(id: string): Promise<Upload> {
    return this.updateStatus(id, 'deleted', { deletedAt: new Date() });
  }

  hardDelete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

/** 전역 JwtAuthGuard 자리 — `x-test-user` 헤더의 JSON 이 검증된 사용자다. @Public 은 건너뛴다. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) === true) return true;
    if (Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass()) === true) return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: object }>();
    const raw = req.headers['x-test-user'];
    const user: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof user === 'object' && user !== null) req.user = user;
    return true;
  }
}

/** 응답 본문의 문자열 칸. 모양이 다르면 그 자리에서 실패한다. */
function field(res: { body: unknown }, name: 'id' | 'url' | 'signedUrl'): string {
  const body = res.body;
  const value: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined;
  if (typeof value !== 'string') throw new Error(`응답에 ${name} 가 없다`);
  return value;
}

const staff = (tenant: string | undefined, userId = '00000000-0000-4000-8000-0000000000a1') =>
  JSON.stringify({ userId, email: 'a@x', roles: ['admin'], ...(tenant ? { tenant } : {}) });

describe('file-service 테넌트 축 — 행의 테넌트, 테넌트 버킷', () => {
  let baseDir: string;
  const apps: INestApplication[] = [];
  const files = new MemoryFiles();

  async function boot(mode: TenantGateMode): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      controllers: [
        UploadController,
        DownloadController,
        LocalFileController,
        LifecycleController,
        InternalFilesController,
      ],
      providers: [
        UploadService,
        DownloadService,
        InternalFilesService,
        FileAccess,
        StorageService,
        StorageProviderRegistry,
        S3StorageProvider,
        LocalStorageProvider,
        PathBuilderService,
        FileContextValidator,
        FileTypeDetector,
        { provide: FileRepository, useValue: files },
        {
          provide: FileContextRepository,
          useValue: { findById: (id: string) => Promise.resolve(FILE_CONTEXTS.find((c) => c.id === id)) },
        },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting() },
        { provide: TenancyConfig, useValue: new TenancyConfig(tenants, mode) },
        { provide: INTERNAL_KEY_ENV, useValue: 'FILE_SERVICE_INTERNAL_KEY' },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            STORAGE_PROVIDER: 'LOCAL',
            LOCAL_STORAGE_DIR: baseDir,
            PORT,
            FILE_SERVICE_INTERNAL_KEY: INTERNAL_KEY,
          }),
        },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: FileRequestTenantInterceptor },
      ],
    }).compile();

    const app = module.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    apps.push(app);
    return app;
  }

  let warn: INestApplication;
  let reject: INestApplication;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'file-tenant-axis-'));
    warn = await boot('warn');
    reject = await boot('reject');
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await rm(baseDir, { recursive: true, force: true });
  });

  const upload = (app: INestApplication, user: string | undefined, contextId: string) => {
    const req = request(app.getHttpServer()).post('/files/upload');
    if (user) req.set('x-test-user', user);
    return req.field('contextId', contextId).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' });
  };

  /** URL 이 가리키는 로컬 디스크 경로. `http://localhost:PORT/files/local/<path>` */
  const diskPathOf = (url: string) => join(baseDir, url.replace(`http://localhost:${PORT}/files/local/`, ''));

  describe('업로드 — 버킷은 요청 테넌트의 목록 항목에서', () => {
    it('테넌트 2 공개 파일은 테넌트 2 공개 버킷에 들어가고 URL 에 그 버킷 이름이 나온다', async () => {
      const res = await upload(reject, staff('2'), 'product-image').expect(200);

      expect(field(res, 'url')).toMatch(new RegExp(`^http://localhost:${PORT}/files/local/two-pub/products/images/`));
      expect(existsSync(diskPathOf(field(res, 'url')))).toBe(true);
      expect(files.rows.get(field(res, 'id'))?.tenantId).toBe('2');
    });

    it('테넌트 2 비공개 파일은 테넌트 2 비공개 버킷에 들어간다', async () => {
      const res = await upload(reject, staff('2'), 'digital-asset-file').expect(200);
      const row = files.rows.get(field(res, 'id'))!;

      expect(row.url).toMatch(new RegExp(`/files/local/two-priv/library/digital-assets/`));
      expect(existsSync(join(baseDir, 'two-priv', row.filePath))).toBe(true);
    });

    it('로컬에선 버킷 디렉터리째 서빙한다 — 올린 URL 로 같은 바이트를 되읽는다', async () => {
      const res = await upload(reject, staff('2'), 'product-image').expect(200);
      const path = new URL(field(res, 'url')).pathname;

      const served = await request(reject.getHttpServer()).get(path).expect(200);
      expect(Buffer.compare(served.body, PNG)).toBe(0);
    });

    it('테넌트 1 파일은 지금과 같은 자리다 — 공용 버킷은 로컬 루트, URL 에 버킷 디렉터리가 없다', async () => {
      const res = await upload(reject, staff('1'), 'product-image').expect(200);
      const row = files.rows.get(field(res, 'id'))!;

      expect(field(res, 'url')).toBe(`http://localhost:${PORT}/files/local/${row.filePath}`);
      expect(existsSync(join(baseDir, row.filePath))).toBe(true);
      expect(row.tenantId).toBe('1');
    });

    it('① 에서 테넌트 없는 토큰의 업로드는 통과한다 — 테넌트 전 위치에, 행은 DB 기본값', async () => {
      const res = await upload(warn, staff(undefined), 'product-image').expect(200);
      const row = files.rows.get(field(res, 'id'))!;

      expect(field(res, 'url')).toBe(`http://localhost:${PORT}/files/local/${row.filePath}`);
      expect(row.tenantId).toBe('1');
    });

    it('② 에서 테넌트 없는 토큰의 업로드는 403 이다', async () => {
      await upload(reject, staff(undefined), 'product-image').expect(403);
    });

    it('목록에 없는 테넌트 토큰은 두 모드 모두 403 이다', async () => {
      await upload(warn, staff('9'), 'product-image').expect(403);
      await upload(reject, staff('9'), 'product-image').expect(403);
    });
  });

  describe('읽기 — 맥락 없는 공개 읽기, 같은 테넌트에서만 여는 직원 예외', () => {
    const UPLOADER = '00000000-0000-4000-8000-0000000000b2';
    const fileOf = async (tenant: string, contextId: string): Promise<string> =>
      field(await upload(reject, staff(tenant, UPLOADER), contextId).expect(200), 'id');
    const download = (app: INestApplication, user: string | undefined, id: string) => {
      const req = request(app.getHttpServer()).get(`/files/${id}/download`);
      return user ? req.set('x-test-user', user) : req;
    };

    it('공개 파일 읽기는 맥락 없이 행의 테넌트 버킷에서 나온다(② 에서도)', async () => {
      const id = await fileOf('2', 'product-image');

      const res = await request(reject.getHttpServer()).get(`/files/public/${id}`).expect(302);
      expect(res.headers.location).toMatch(new RegExp(`/files/local/two-pub/products/images/`));
    });

    it('② 에서 공개 읽기가 아닌 맥락 없는 요청은 실패한다', async () => {
      const id = await fileOf('1', 'digital-asset-file');
      await download(reject, staff(undefined), id).expect(403);
    });

    it.each(['digital-asset-file', 'archive-page-attachment'])(
      '직원 키 예외(%s)는 파일 테넌트 = 토큰 테넌트일 때만 연다 — 테넌트 2 토큰으로 테넌트 1 파일은 403',
      async (contextId) => {
        const id = await fileOf('1', contextId);

        await download(reject, staff('2'), id).expect(403);
        const res = await download(reject, staff('1'), id).expect(200);
        expect(field(res, 'signedUrl')).toBe(`http://localhost:${PORT}/files/local/${files.rows.get(id)!.filePath}`);
      },
    );

    it('테넌트 2 비공개 파일의 서명 URL 은 테넌트 2 비공개 버킷이다', async () => {
      const id = await fileOf('2', 'digital-asset-file');

      const res = await download(reject, staff('2'), id).expect(200);
      expect(field(res, 'signedUrl')).toMatch(new RegExp(`/files/local/two-priv/library/digital-assets/`));
    });

    it('파일 관리자 예외(삭제)도 다른 테넌트 파일에는 열리지 않는다', async () => {
      const id = await fileOf('1', 'digital-asset-file');
      const master = (tenant: string) => JSON.stringify({ userId: 'm-1', email: 'm@x', roles: ['master'], tenant });

      await request(reject.getHttpServer()).delete(`/files/${id}`).set('x-test-user', master('2')).expect(403);
      await request(reject.getHttpServer()).delete(`/files/${id}`).set('x-test-user', master('1')).expect(200);
    });

    it('core 위임 토큰도 토큰 테넌트의 파일만 연다', async () => {
      const id = await fileOf('1', 'digital-asset-file');
      const delegation = (tenant: string) =>
        JSON.stringify({ userId: 'u-9', email: '', roles: [], act: { sub: 'core' }, aud: 'file-service', tenant });

      await download(reject, delegation('2'), id).expect(403);
      await download(reject, delegation('1'), id).expect(200);
    });
  });

  describe('내부 키 라우트 — 테넌트 헤더의 파일만', () => {
    const internal = (app: INestApplication, id: string, tenant?: string) => {
      const req = request(app.getHttpServer())
        .get(`/internal/files/${id}`)
        .set('authorization', `Bearer ${INTERNAL_KEY}`);
      return tenant ? req.set(TENANT_HEADER, tenant) : req;
    };

    it('헤더 테넌트의 파일은 답하고, 다른 테넌트 파일은 없는 것으로 답한다', async () => {
      const id = field(await upload(reject, staff('1'), 'product-image').expect(200), 'id');

      await internal(reject, id, '1').expect(200);
      await internal(reject, id, '2').expect(404);
    });

    it('헤더 없는 호출은 ① 통과, ② 403', async () => {
      const id = field(await upload(reject, staff('1'), 'product-image').expect(200), 'id');

      await internal(warn, id).expect(200);
      await internal(reject, id).expect(403);
    });
  });
});

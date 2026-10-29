import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as request from 'supertest';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { LocalFileController } from './local-file.controller';

const FILE_ID = '01933e7a-1234-7890-abcd-0123456789ab';
const STOREFRONT_ORIGIN = 'https://www.example.com';

describe('public file browser access', () => {
  let app: INestApplication;
  let baseDir: string;
  const glb = Buffer.from('glTF-model-bytes');

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'public-model-cors-'));
    await writeFile(join(baseDir, 'model.glb'), glb);

    const module = await Test.createTestingModule({
      controllers: [DownloadController, LocalFileController],
      providers: [
        {
          provide: DownloadService,
          useValue: {
            resolvePublicUrl: async () => 'https://public-bucket.example.com/model.glb',
            getMetadata: async () => ({ id: FILE_ID }),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ STORAGE_PROVIDER: 'LOCAL', LOCAL_STORAGE_DIR: baseDir }),
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rm(baseDir, { recursive: true, force: true });
  });

  it.each(['get', 'head'] as const)('allows public %s redirects without credentials', async (method) => {
    const response = await request(app.getHttpServer())
      [method](`/files/public/${FILE_ID}`)
      .set('Origin', STOREFRONT_ORIGIN)
      .expect(302);

    expect(response.headers.location).toBe('https://public-bucket.example.com/model.glb');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each(['get', 'head'] as const)('serves local GLB %s with model MIME and public CORS', async (method) => {
    const response = await request(app.getHttpServer())
      [method]('/files/local/model.glb')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .set('Origin', STOREFRONT_ORIGIN)
      .expect(200);

    expect(response.headers['content-type']).toBe('model/gltf-binary');
    expect(response.headers['content-length']).toBe(String(glb.length));
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();

    if (method === 'get') {
      expect(response.body).toEqual(glb);
    }
  });

  it('does not expose private metadata to cross-origin reads', async () => {
    const response = await request(app.getHttpServer())
      .get(`/files/${FILE_ID}/metadata`)
      .set('Origin', STOREFRONT_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

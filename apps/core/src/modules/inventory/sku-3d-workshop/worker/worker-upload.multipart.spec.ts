import { HttpException } from '@nestjs/common';
import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { readWorkerUpload } from './worker-upload.multipart';

// core 와 같은 Fastify + multipart 위에서 실제 multipart 본문을 읽는다 — multer 로는 Fastify 요청을 못 읽는다
async function post(form: FormData) {
  const app = Fastify();

  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.post('/upload', async (request, reply) => {
    try {
      const upload = await readWorkerUpload(request);

      return {
        name: upload.name,
        bytes: upload.bytes.length,
        leaseToken: upload.leaseToken,
        mimeType: upload.mimeType,
      };
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;

      return reply.code(status).send({ error: String(error) });
    }
  });

  const body = new Response(form);
  const response = await app.inject({
    method: 'POST',
    url: '/upload',
    headers: { 'content-type': body.headers.get('content-type') ?? '' },
    payload: Buffer.from(await body.arrayBuffer()),
  });

  await app.close();

  return response;
}

describe('readWorkerUpload', () => {
  const leaseToken = '0193c8a2-1111-7000-8000-000000000001';

  it('reads the lease token and the file', async () => {
    const form = new FormData();

    form.append('leaseToken', leaseToken);
    form.append('file', new Blob([new Uint8Array(5)], { type: 'model/gltf-binary' }), 'model.glb');

    const response = await post(form);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'model.glb', bytes: 5, leaseToken, mimeType: 'model/gltf-binary' });
  });

  it('accepts files above the global 10MB multipart limit', async () => {
    const form = new FormData();

    form.append('leaseToken', leaseToken);
    form.append('file', new Blob([new Uint8Array(12 * 1024 * 1024)]), 'model.blend');

    expect((await post(form)).statusCode).toBe(200);
  });

  it('answers 413 for an oversize file or a second file', async () => {
    const big = new FormData();

    big.append('leaseToken', leaseToken);
    big.append('file', new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]), 'model.blend');

    const two = new FormData();

    two.append('leaseToken', leaseToken);
    two.append('file', new Blob([new Uint8Array(1)]), 'a.png');
    two.append('file', new Blob([new Uint8Array(1)]), 'b.png');

    expect((await post(big)).statusCode).toBe(413);
    expect((await post(two)).statusCode).toBe(413);
  });

  it('rejects a missing lease token', async () => {
    const form = new FormData();

    form.append('file', new Blob([new Uint8Array(1)]), 'a.png');

    expect((await post(form)).statusCode).toBe(400);
  });
});

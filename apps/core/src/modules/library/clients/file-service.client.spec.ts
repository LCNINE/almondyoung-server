import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { FileServiceClient } from './file-service.client';

const SECRET = 'secret';

function client(): FileServiceClient {
  return new FileServiceClient(new ConfigService({ AUTH_SECRET: SECRET, FILE_SERVICE_URL: 'http://file-service/' }));
}

function respondWith(body: object): jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>> {
  return jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
}

function sent(fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>): {
  url: string;
  token: unknown;
} {
  const [input, init] = fetchMock.mock.calls[0];
  const auth = new Headers(init?.headers).get('Authorization') ?? '';
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  return { url, token: verify(auth.replace('Bearer ', ''), SECRET) };
}

describe('library FileServiceClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks for a download link on behalf of the requester', async () => {
    const fetchMock = respondWith({ signedUrl: 'https://s/a' });

    await expect(client().getDownloadUrl('f1', 'customer-1')).resolves.toBe('https://s/a');

    const { url, token } = sent(fetchMock);
    expect(url).toBe('http://file-service/files/f1/download?expiresIn=60&download=true');
    expect(token).toMatchObject({ sub: 'customer-1', act: { sub: 'core' }, aud: 'file-service' });
    expect(token).not.toHaveProperty('scopes');
  });

  it('preserves explicit public access for approved GLB validation and fails closed when omitted', async () => {
    const response = respondWith({ isPublic: true, mimeType: 'model/gltf-binary', contextId: 'sku-3d-model' });

    await expect(client().fetchMetadata('glb', 'admin-1')).resolves.toMatchObject({ isPublic: true });

    response.mockResolvedValueOnce(new Response(JSON.stringify({})));

    await expect(client().fetchMetadata('legacy', 'admin-1')).resolves.toMatchObject({ isPublic: false });
  });

  it('reads metadata on behalf of the requester', async () => {
    const fetchMock = respondWith({ fileName: 'a.zip', status: 'active', contextId: 'digital-asset-file' });

    await expect(client().fetchMetadata('f1', 'admin-1')).resolves.toMatchObject({
      fileName: 'a.zip',
      status: 'active',
    });
    expect(sent(fetchMock).token).toMatchObject({ sub: 'admin-1', act: { sub: 'core' }, aud: 'file-service' });
  });
});

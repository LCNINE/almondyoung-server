import { ConfigService } from '@nestjs/config';
import { S3StorageProvider } from './s3-storage.provider';

// getSignedUrl 은 네트워크 없이 서명만 계산하므로 더미 자격증명으로 실 서명을 검증한다.
describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    const env: Record<string, string> = {
      STORAGE_PROVIDER: 'S3',
      AWS_REGION: 'ap-northeast-2',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      AWS_S3_PUBLIC_BUCKET: 'public-bucket',
      AWS_S3_PRIVATE_BUCKET: 'private-bucket',
    };
    const configService = {
      get: jest.fn((key: string, def?: string) => env[key] ?? def),
      getOrThrow: jest.fn((key: string) => {
        if (!env[key]) throw new Error(`missing ${key}`);
        return env[key];
      }),
    } as unknown as ConfigService;

    provider = new S3StorageProvider(configService);
    provider.onModuleInit();
  });

  function signedHeadersOf(url: string): string {
    const value = new URL(url).searchParams.get('X-Amz-SignedHeaders');
    return decodeURIComponent(value ?? '');
  }

  describe('createDirectUpload', () => {
    it('공개 업로드는 x-amz-acl 이 서명된 쿼리로 들어가고 Content-Type 헤더를 돌려준다', async () => {
      const result = await provider.createDirectUpload({
        key: 'banners/images/2026/08/f1.webp',
        contentType: 'image/webp',
        isPublic: true,
        expiresIn: 600,
      });

      const params = new URL(result.uploadUrl).searchParams;
      expect(params.get('x-amz-acl')).toBe('public-read');
      expect(params.get('X-Amz-Signature')).toBeTruthy();
      expect(result.headers).toEqual({ 'Content-Type': 'image/webp' });
      expect(result.uploadUrl).toContain('public-bucket');
      expect(result.fileUrl).toBe(
        'https://public-bucket.s3.ap-northeast-2.amazonaws.com/banners/images/2026/08/f1.webp',
      );
    });

    it('비공개 업로드는 비공개 버킷으로 가고 ACL 을 붙이지 않는다', async () => {
      const result = await provider.createDirectUpload({
        key: 'library/digital-assets/2026/08/f2.zip',
        contentType: 'application/zip',
        isPublic: false,
        expiresIn: 600,
      });

      const params = new URL(result.uploadUrl).searchParams;
      expect(params.get('x-amz-acl')).toBeNull();
      expect(result.headers).toEqual({ 'Content-Type': 'application/zip' });
      expect(result.uploadUrl).toContain('private-bucket');
    });

    it('checksum 파라미터를 서명에 넣지 않는다 — 있으면 브라우저의 실제 본문 PUT 이 전부 거부된다', async () => {
      const result = await provider.createDirectUpload({
        key: 'a/b.webp',
        contentType: 'image/webp',
        isPublic: true,
        expiresIn: 600,
      });

      const params = new URL(result.uploadUrl).searchParams;
      expect([...params.keys()].filter((k) => k.toLowerCase().includes('checksum'))).toEqual([]);
    });
  });

  describe('getSignedUrl (download 회귀)', () => {
    it('GET presign 은 종전대로 서명되고 Content-Type 을 서명에 넣지 않는다', async () => {
      const result = await provider.getSignedUrl({
        key: 'library/digital-assets/2026/08/f2.zip',
        expiresIn: 300,
        operation: 'get',
        isPublic: false,
        responseContentDisposition: "attachment; filename*=UTF-8''f2.zip",
      });

      const url = new URL(result.signedUrl);
      expect(url.hostname).toContain('private-bucket');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('response-content-disposition')).toContain('attachment');
      expect(signedHeadersOf(result.signedUrl)).toBe('host');
    });
  });
});

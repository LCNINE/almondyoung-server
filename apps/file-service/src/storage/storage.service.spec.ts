import { ConfigService } from '@nestjs/config';
import { parseTenantList, TenancyConfig } from '@app/tenancy';
import { StorageProviderRegistry } from './storage-provider.registry';
import { StorageService } from './storage.service';

const tenancy = new TenancyConfig(
  parseTenantList(
    JSON.stringify([
      { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'one-shared', privateBucket: 'one-shared' },
      { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'two-pub', privateBucket: 'two-priv' },
    ]),
  ),
  'warn',
);
const registry = {} as StorageProviderRegistry;
const boot = (env: Record<string, string>) => new StorageService(registry, tenancy, new ConfigService(env));

describe('StorageService — 테넌트 전 버킷(env)', () => {
  // ① 의 테넌트 모르는 쓰기는 env 버킷에 들어가고 행은 DB 기본값(테넌트 1)을 받는다 — 되읽기는 목록의 그 테넌트 버킷이다.
  // 둘이 갈리면 그 파일은 조용히 못 찾게 되므로, 부팅에서 막는다.
  it('env 버킷이 목록의 공용 버킷이면 뜬다', () => {
    expect(() => boot({ AWS_S3_PUBLIC_BUCKET: 'one-shared', AWS_S3_PRIVATE_BUCKET: 'one-shared' })).not.toThrow();
  });

  it('env 버킷이 목록의 공용 버킷과 다르면 기동을 거부한다', () => {
    expect(() => boot({ AWS_S3_PUBLIC_BUCKET: 'legacy-public', AWS_S3_PRIVATE_BUCKET: 'one-shared' })).toThrow(
      /AWS_S3_PUBLIC_BUCKET/,
    );
    expect(() => boot({ AWS_S3_PUBLIC_BUCKET: 'two-pub', AWS_S3_PRIVATE_BUCKET: 'two-priv' })).toThrow();
  });

  it('env 버킷이 없으면(LOCAL) 검사할 것이 없다', () => {
    expect(() => boot({})).not.toThrow();
  });
});

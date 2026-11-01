import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StepRefused } from '../runner';
import type { BucketAccess, Buckets } from '../steps';
import { isAwsError, sameJson, type Aws } from './aws-cli';

/**
 * 테넌트 버킷 둘(ADR 0005 교정 24). 버킷은 SST 리소스가 아니라 이 스크립트가 만든다.
 * - 공개: file-service 가 공개 파일을 `ACL: 'public-read'` 로 올린다 → ACL 을 허용(BucketOwnerPreferred,
 *   BlockPublicAcls·IgnorePublicAcls 끔)하고, 버킷 정책으로 통째 공개하는 길은 막는다.
 * - 비공개: 공개 접근 전부 차단, ACL 끔(BucketOwnerEnforced).
 * - CORS: 테넌트 도메인만 — 브라우저가 서명 URL 로 바로 올리고(PUT) 읽는다(GET).
 */
export function desiredBucketSettings(access: BucketAccess, origins: readonly string[]) {
  const isPublic = access === 'public';
  return {
    objectOwnership: isPublic ? 'BucketOwnerPreferred' : 'BucketOwnerEnforced',
    publicAccessBlock: {
      BlockPublicAcls: !isPublic,
      IgnorePublicAcls: !isPublic,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
    cors: {
      CORSRules: [
        {
          AllowedOrigins: [...origins],
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  };
}

type Settings = ReturnType<typeof desiredBucketSettings>;

export class S3Buckets implements Buckets {
  constructor(
    private readonly aws: Aws,
    private readonly region: string,
    private readonly corsOrigins: readonly string[],
    /** 쓰기·읽기 확인을 file-service 의 S3 키로 한다 — IAM 권한까지 잰다. 없으면 운영자 자격증명 */
    private readonly probeEnv?: () => Promise<NodeJS.ProcessEnv>,
  ) {}

  private async exists(bucket: string): Promise<boolean> {
    try {
      await this.aws(['s3api', 'head-bucket', '--bucket', bucket], { region: this.region });
      return true;
    } catch (e) {
      if (isAwsError(e, '404', 'NoSuchBucket', 'NotFound')) return false;
      if (isAwsError(e, '403', 'Forbidden')) {
        throw new StepRefused(
          `버킷 ${bucket} 은 다른 계정의 것이다 — 계획 파일의 버킷 두 칸을 지우고 다시 돌려 새 이름을 받는다`,
        );
      }
      throw e;
    }
  }

  private async current(bucket: string): Promise<{ ownership?: string; pab?: unknown; cors?: unknown }> {
    const read = async <T>(args: string[], missing: string, pick: (r: never) => T): Promise<T | undefined> => {
      try {
        return pick((await this.aws(['s3api', ...args, '--bucket', bucket], { region: this.region })) as never);
      } catch (e) {
        if (isAwsError(e, missing)) return undefined;
        throw e;
      }
    };
    return {
      ownership: await read(
        ['get-bucket-ownership-controls'],
        'OwnershipControlsNotFoundError',
        (r: { OwnershipControls: { Rules: { ObjectOwnership: string }[] } }) =>
          r.OwnershipControls.Rules[0]?.ObjectOwnership,
      ),
      pab: await read(
        ['get-public-access-block'],
        'NoSuchPublicAccessBlockConfiguration',
        (r: { PublicAccessBlockConfiguration: unknown }) => r.PublicAccessBlockConfiguration,
      ),
      cors: await read(['get-bucket-cors'], 'NoSuchCORSConfiguration', (r: unknown) => r),
    };
  }

  private diff(now: Awaited<ReturnType<S3Buckets['current']>>, want: Settings) {
    return {
      ownership: now.ownership !== want.objectOwnership,
      pab: !sameJson(now.pab, want.publicAccessBlock),
      cors: !sameJson(now.cors, want.cors),
    };
  }

  async ready(bucket: string, access: BucketAccess) {
    if (!(await this.exists(bucket))) return false;
    const d = this.diff(await this.current(bucket), desiredBucketSettings(access, this.corsOrigins));
    return !d.ownership && !d.pab && !d.cors;
  }

  async ensure(bucket: string, access: BucketAccess) {
    const s3 = (args: string[]) => this.aws(['s3api', ...args, '--bucket', bucket], { region: this.region });
    if (!(await this.exists(bucket))) {
      await s3(['create-bucket', '--create-bucket-configuration', JSON.stringify({ LocationConstraint: this.region })]);
    }
    const want = desiredBucketSettings(access, this.corsOrigins);
    const d = this.diff(await this.current(bucket), want);
    // 소유권 먼저 — ACL 을 허용하지 않은 버킷에 공개 접근 차단을 풀어도 ACL 이 안 먹는다.
    if (d.ownership) {
      await s3([
        'put-bucket-ownership-controls',
        '--ownership-controls',
        JSON.stringify({ Rules: [{ ObjectOwnership: want.objectOwnership }] }),
      ]);
    }
    if (d.pab)
      await s3([
        'put-public-access-block',
        '--public-access-block-configuration',
        JSON.stringify(want.publicAccessBlock),
      ]);
    if (d.cors) await s3(['put-bucket-cors', '--cors-configuration', JSON.stringify(want.cors)]);
  }

  async removeIfEmpty(bucket: string) {
    if (!(await this.exists(bucket))) return;
    const listed = (await this.aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--max-keys', '1'], {
      region: this.region,
    })) as { KeyCount?: number } | null;
    if ((listed?.KeyCount ?? 0) > 0) throw new Error(`버킷 ${bucket} 이 비어 있지 않아 남긴다`);
    await this.aws(['s3api', 'delete-bucket', '--bucket', bucket], { region: this.region });
  }

  async probe(bucket: string) {
    const env = await this.probeEnv?.();
    const dir = await mkdtemp(join(tmpdir(), 'tenant-probe-'));
    const key = `.tenant-create-probe/${process.pid}-${Date.now()}`;
    const body = `probe ${new Date().toISOString()}`;
    try {
      await writeFile(join(dir, 'in'), body);
      const s3 = (args: string[]) =>
        this.aws(['s3api', ...args, '--bucket', bucket, '--key', key], { region: this.region, env });
      await s3(['put-object', '--body', join(dir, 'in')]);
      try {
        await this.aws(['s3api', 'get-object', '--bucket', bucket, '--key', key, join(dir, 'out')], {
          region: this.region,
          env,
        });
        if ((await readFile(join(dir, 'out'), 'utf8')) !== body) throw new Error('읽은 내용이 쓴 내용과 다르다');
      } finally {
        await s3(['delete-object']);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

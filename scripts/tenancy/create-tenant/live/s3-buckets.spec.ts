import { StepRefused } from '../runner';
import { arg, awsError, fakeAws } from './fake-aws';
import { desiredBucketSettings, S3Buckets } from './s3-buckets';

/**
 * 테넌트 버킷 — 공개 = 객체 ACL 공개 읽기(ACL 허용 + 정책 공개는 막음), 비공개 = 공개 접근 전부 차단,
 * CORS 는 테넌트 도메인만(ADR 0005 교정 24). 이미 그대로면 아무것도 쓰지 않는다.
 */
const origins = ['https://admin.acme.test', 'https://login.acme.test'];

/** 버킷 상태를 들고 있는 가짜 S3 — put 이 상태를 바꾼다 */
function s3World(
  initial: Record<string, { owner?: 'other'; pab?: unknown; ownership?: string; cors?: unknown; objects?: number }>,
) {
  const buckets = new Map(Object.entries(initial));
  return fakeAws((args) => {
    const b = arg(args, '--bucket') ?? '';
    const state = buckets.get(b);
    switch (args[1]) {
      case 'head-bucket':
        if (!state) return awsError('404');
        return state.owner === 'other' ? awsError('403') : {};
      case 'create-bucket':
        buckets.set(b, {});
        return {};
      case 'get-public-access-block':
        return state?.pab
          ? { PublicAccessBlockConfiguration: state.pab }
          : awsError('NoSuchPublicAccessBlockConfiguration');
      case 'put-public-access-block':
        state!.pab = JSON.parse(arg(args, '--public-access-block-configuration')!);
        return null;
      case 'get-bucket-ownership-controls':
        return state?.ownership
          ? { OwnershipControls: { Rules: [{ ObjectOwnership: state.ownership }] } }
          : awsError('OwnershipControlsNotFoundError');
      case 'put-bucket-ownership-controls':
        state!.ownership = JSON.parse(arg(args, '--ownership-controls')!).Rules[0].ObjectOwnership;
        return null;
      case 'get-bucket-cors':
        return state?.cors ? state.cors : awsError('NoSuchCORSConfiguration');
      case 'put-bucket-cors':
        state!.cors = JSON.parse(arg(args, '--cors-configuration')!);
        return null;
      case 'list-objects-v2':
        return { KeyCount: state?.objects ?? 0 };
      case 'delete-bucket':
        buckets.delete(b);
        return null;
      default:
        throw new Error(`이 spec 은 ${args.join(' ')} 을 부르지 않는다`);
    }
  });
}

const configured = (access: 'public' | 'private') => {
  const d = desiredBucketSettings(access, origins);
  return { pab: d.publicAccessBlock, ownership: d.objectOwnership, cors: d.cors };
};

const s3 = (aws: ReturnType<typeof fakeAws>['aws']) => new S3Buckets(aws, 'ap-northeast-2', origins);

describe('S3 테넌트 버킷', () => {
  it('없는 버킷은 만들고 설정 셋을 맞춘다 — 그 뒤엔 «준비됨»', async () => {
    const w = s3World({});
    const buckets = s3(w.aws);

    expect(await buckets.ready('acme-public-x1', 'public')).toBe(false);
    await buckets.ensure('acme-public-x1', 'public');

    expect(w.writes()).toEqual([
      's3api create-bucket',
      's3api put-bucket-ownership-controls',
      's3api put-public-access-block',
      's3api put-bucket-cors',
    ]);
    expect(await buckets.ready('acme-public-x1', 'public')).toBe(true);
  });

  it('이미 그대로인 버킷엔 아무것도 쓰지 않는다', async () => {
    const w = s3World({ 'acme-private-x1': configured('private') });
    const buckets = s3(w.aws);

    expect(await buckets.ready('acme-private-x1', 'private')).toBe(true);
    await buckets.ensure('acme-private-x1', 'private');

    expect(w.writes()).toEqual([]);
  });

  it('하나만 틀리면 그것만 고친다 — CORS 원본이 다르면 CORS 만', async () => {
    const w = s3World({
      'acme-public-x1': { ...configured('public'), cors: desiredBucketSettings('public', ['https://x.test']).cors },
    });
    await s3(w.aws).ensure('acme-public-x1', 'public');
    expect(w.writes()).toEqual(['s3api put-bucket-cors']);
  });

  it('공개는 ACL 을 허용하고 정책 공개는 막는다, 비공개는 전부 막는다', () => {
    expect(desiredBucketSettings('public', origins)).toMatchObject({
      objectOwnership: 'BucketOwnerPreferred',
      publicAccessBlock: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    });
    expect(desiredBucketSettings('private', origins)).toMatchObject({
      objectOwnership: 'BucketOwnerEnforced',
      publicAccessBlock: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    });
    expect(desiredBucketSettings('public', origins).cors.CORSRules[0].AllowedOrigins).toEqual(origins);
  });

  it('남의 계정 버킷(403)이면 손대지 않는다', async () => {
    const w = s3World({ 'acme-public-x1': { owner: 'other' } });
    await expect(s3(w.aws).ready('acme-public-x1', 'public')).rejects.toBeInstanceOf(StepRefused);
    expect(w.writes()).toEqual([]);
  });

  it('되돌리기는 빈 버킷만 지운다 — 없으면 아무것도 안 한다', async () => {
    const w = s3World({ 'acme-public-x1': { objects: 1 }, 'acme-private-x1': {} });
    const buckets = s3(w.aws);

    await expect(buckets.removeIfEmpty('acme-public-x1')).rejects.toThrow(/비어 있지 않/);
    await buckets.removeIfEmpty('acme-private-x1');
    await buckets.removeIfEmpty('acme-gone-x1');

    expect(w.writes()).toEqual(['s3api delete-bucket']);
  });
});

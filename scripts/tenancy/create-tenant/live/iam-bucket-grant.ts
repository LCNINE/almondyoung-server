import type { BucketGrant } from '../steps';
import { isAwsError, sameJson, type Aws } from './aws-cli';

/**
 * file-service S3 접근 키(`AwsS3AccessKeyId` Secret 의 IAM 사용자)에 테넌트 버킷 둘의 권한 — 테넌트마다 인라인 정책 하나.
 * 그 사용자에 이미 더 넓은 권한이 있어도 이 정책을 둔다: 테넌트 버킷이 무엇에 기대는지가 이 한 장에 보인다.
 * 「만든 직후 확인」의 버킷 쓰기·읽기가 같은 키로 돌아 이 권한까지 잰다.
 */
export function bucketPolicyDocument(buckets: readonly string[]) {
  return {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: buckets.map((b) => `arn:aws:s3:::${b}`) },
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:PutObjectAcl', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        Resource: buckets.map((b) => `arn:aws:s3:::${b}/*`),
      },
    ],
  };
}

export class IamBucketGrant implements BucketGrant {
  private user: string | null = null;

  constructor(
    private readonly aws: Aws,
    private readonly accessKeyId: () => Promise<string>,
    private readonly policyName: string,
    private readonly buckets: readonly string[],
  ) {}

  private async userName(): Promise<string> {
    if (this.user) return this.user;
    const r = (await this.aws(['iam', 'get-access-key-last-used', '--access-key-id', await this.accessKeyId()])) as {
      UserName?: string;
    };
    if (!r.UserName) throw new Error('file-service S3 키의 IAM 사용자를 못 찾았다(AwsS3AccessKeyId)');
    this.user = r.UserName;
    return this.user;
  }

  async granted() {
    try {
      const r = (await this.aws([
        'iam',
        'get-user-policy',
        '--user-name',
        await this.userName(),
        '--policy-name',
        this.policyName,
      ])) as { PolicyDocument: unknown };
      // CLI 는 문서를 풀어 주지만, 버전에 따라 URL 인코딩된 문자열로 오기도 한다.
      const doc =
        typeof r.PolicyDocument === 'string' ? JSON.parse(decodeURIComponent(r.PolicyDocument)) : r.PolicyDocument;
      return sameJson(doc, bucketPolicyDocument(this.buckets));
    } catch (e) {
      if (isAwsError(e, 'NoSuchEntity')) return false;
      throw e;
    }
  }

  async grant() {
    await this.aws([
      'iam',
      'put-user-policy',
      '--user-name',
      await this.userName(),
      '--policy-name',
      this.policyName,
      '--policy-document',
      JSON.stringify(bucketPolicyDocument(this.buckets)),
    ]);
  }

  async revoke() {
    try {
      await this.aws([
        'iam',
        'delete-user-policy',
        '--user-name',
        await this.userName(),
        '--policy-name',
        this.policyName,
      ]);
    } catch (e) {
      if (!isAwsError(e, 'NoSuchEntity')) throw e;
    }
  }
}

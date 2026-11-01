import { StepPaused } from '../runner';
import { AcmCertificates } from './acm-certificates';
import { arg, awsError, fakeAws } from './fake-aws';
import { bucketPolicyDocument, IamBucketGrant } from './iam-bucket-grant';

/** file-service S3 키(IAM 사용자)에 테넌트 버킷 둘 — 인라인 정책 하나. 같으면 쓰지 않는다. */
describe('버킷 접근 권한', () => {
  function iamWorld(initial: unknown | null) {
    let doc = initial;
    const w = fakeAws((args) => {
      switch (args[1]) {
        case 'get-access-key-last-used':
          return { UserName: 'file-service-s3' };
        case 'get-user-policy':
          return doc === null ? awsError('NoSuchEntity') : { PolicyDocument: doc };
        case 'put-user-policy':
          doc = JSON.parse(arg(args, '--policy-document')!);
          return null;
        case 'delete-user-policy':
          if (doc === null) return awsError('NoSuchEntity');
          doc = null;
          return null;
        default:
          throw new Error(args.join(' '));
      }
    });
    return { ...w, doc: () => doc };
  }
  const grant = (aws: ReturnType<typeof fakeAws>['aws']) =>
    new IamBucketGrant(aws, async () => 'AKIAEXAMPLE', 'tenant-acme-buckets', ['acme-public-x1', 'acme-private-x1']);

  it('정책이 없으면 넣고, 그 뒤엔 «됐다»', async () => {
    const w = iamWorld(null);
    const g = grant(w.aws);

    expect(await g.granted()).toBe(false);
    await g.grant();

    expect(w.writes()).toEqual(['iam put-user-policy']);
    expect(arg(w.calls.find((c) => c[1] === 'put-user-policy')!, '--user-name')).toBe('file-service-s3');
    expect(await g.granted()).toBe(true);
  });

  it('문서가 같으면(배열 순서만 다르다) «됐다» — URL 인코딩된 문자열로 와도 같다', async () => {
    const doc = bucketPolicyDocument(['acme-private-x1', 'acme-public-x1']);
    expect(await grant(iamWorld(doc).aws).granted()).toBe(true);
    expect(await grant(iamWorld(encodeURIComponent(JSON.stringify(doc))).aws).granted()).toBe(true);
  });

  it('정책은 두 버킷과 그 객체만 연다', () => {
    const resources = bucketPolicyDocument(['acme-public-x1', 'acme-private-x1']).Statement.flatMap((s) => s.Resource);
    expect(resources.sort()).toEqual([
      'arn:aws:s3:::acme-private-x1',
      'arn:aws:s3:::acme-private-x1/*',
      'arn:aws:s3:::acme-public-x1',
      'arn:aws:s3:::acme-public-x1/*',
    ]);
  });

  it('되돌리기는 없으면 아무것도 안 한다', async () => {
    const w = iamWorld(null);
    await grant(w.aws).revoke();
    expect(w.doc()).toBeNull();
  });
});

/** us-east-1 인증서 — 테넌트 도메인 하나에 하나(다른 이름이 SAN 에 섞이면 그 테넌트 인증서가 아니다). */
describe('테넌트 도메인 인증서', () => {
  type Cert = {
    arn: string;
    domain: string;
    sans: string[];
    status: string;
    record?: { Name: string; Type: string; Value: string };
  };

  function acmWorld(certs: Cert[], opts: { issueAfterPolls?: number; zoneRecords?: string[] } = {}) {
    let polls = 0;
    const records = new Set(opts.zoneRecords ?? []);
    const w = fakeAws((args) => {
      switch (args[1]) {
        case 'list-certificates':
          return {
            CertificateSummaryList: certs.map((c) => ({
              CertificateArn: c.arn,
              DomainName: c.domain,
              SubjectAlternativeNameSummaries: c.sans,
              Status: c.status,
            })),
          };
        case 'request-certificate': {
          const c: Cert = {
            arn: `arn:new:${arg(args, '--domain-name')}`,
            domain: arg(args, '--domain-name')!,
            sans: [arg(args, '--domain-name')!],
            status: 'PENDING_VALIDATION',
            record: { Name: '_x.login.acme.test.', Type: 'CNAME', Value: '_y.acm-validations.aws.' },
          };
          certs.push(c);
          return { CertificateArn: c.arn };
        }
        case 'describe-certificate': {
          const c = certs.find((x) => x.arn === arg(args, '--certificate-arn'))!;
          if (c.status === 'PENDING_VALIDATION' && records.has(c.record!.Name)) {
            polls++;
            if (polls >= (opts.issueAfterPolls ?? 1)) c.status = 'ISSUED';
          }
          return {
            Certificate: {
              Status: c.status,
              DomainValidationOptions: [{ DomainName: c.domain, ResourceRecord: c.record }],
            },
          };
        }
        case 'list-resource-record-sets':
          return {
            ResourceRecordSets: [...records].map((Name) => ({
              Name,
              Type: 'CNAME',
              ResourceRecords: [{ Value: '_y.acm-validations.aws.' }],
            })),
          };
        case 'change-resource-record-sets': {
          const batch = JSON.parse(arg(args, '--change-batch')!);
          records.add(batch.Changes[0].ResourceRecordSet.Name);
          return { ChangeInfo: { Id: 'c1' } };
        }
        default:
          throw new Error(args.join(' '));
      }
    });
    return w;
  }

  const acm = (aws: ReturnType<typeof fakeAws>['aws'], maxPolls = 5) =>
    new AcmCertificates(aws, { zoneFor: async () => 'ZACME1', pollMs: 0, maxPolls, sleep: async () => undefined });

  it('발급된 인증서가 있으면 «됐다» — 새로 요청하지 않는다', async () => {
    const w = acmWorld([{ arn: 'arn:a', domain: 'admin.acme.test', sans: ['admin.acme.test'], status: 'ISSUED' }]);
    const certs = acm(w.aws);

    expect(await certs.issued('admin.acme.test')).toBe(true);
    expect(await certs.arnFor('admin.acme.test')).toBe('arn:a');
    expect(w.writes()).toEqual([]);
  });

  it('SAN 에 다른 이름이 섞인 인증서는 이 도메인 것으로 치지 않는다', async () => {
    const w = acmWorld([
      { arn: 'arn:a', domain: 'admin.acme.test', sans: ['admin.acme.test', 'admin.other.test'], status: 'ISSUED' },
    ]);
    expect(await acm(w.aws).issued('admin.acme.test')).toBe(false);
  });

  it('없으면 요청 → 검증 레코드 → 발급까지 기다린다', async () => {
    const w = acmWorld([]);
    const certs = acm(w.aws);

    await certs.request('login.acme.test');

    expect(w.writes()).toEqual(['acm request-certificate', 'route53 change-resource-record-sets']);
    expect(await certs.issued('login.acme.test')).toBe(true);
  });

  it('검증 대기 중인 인증서가 있으면 그걸 잇는다 — 레코드가 이미 있으면 쓰지 않는다', async () => {
    const pending: Cert = {
      arn: 'arn:p',
      domain: 'login.acme.test',
      sans: ['login.acme.test'],
      status: 'PENDING_VALIDATION',
      record: { Name: '_x.login.acme.test.', Type: 'CNAME', Value: '_y.acm-validations.aws.' },
    };
    const w = acmWorld([pending], { zoneRecords: ['_x.login.acme.test.'] });

    await acm(w.aws).request('login.acme.test');

    expect(w.writes()).toEqual([]);
    expect(pending.status).toBe('ISSUED');
  });

  it('기다려도 발급이 안 나오면 실패가 아니라 멈춤 — 다시 돌리면 이어서 기다린다', async () => {
    const w = acmWorld([], { issueAfterPolls: 99 });
    await expect(acm(w.aws, 3).request('login.acme.test')).rejects.toBeInstanceOf(StepPaused);
  });
});

import { createHash } from 'node:crypto';
import { StepPaused } from '../runner';
import type { Certificates } from '../steps';
import { isAwsError, type Aws } from './aws-cli';

/**
 * 테넌트 도메인 인증서 — CloudFront 가 읽는 us-east-1 에, 도메인 하나에 하나. SAN 에 다른 이름이 섞이면 그 테넌트의
 * 인증서가 아니다(공개 CT 로그에 남는다 — ADR 0008 교정). DNS 검증 레코드는 그 도메인의 Route53 존에 넣는다.
 * 발급 대기가 길면 실패가 아니라 멈춤(`StepPaused`)이다 — 다시 돌리면 같은 인증서를 이어서 기다린다.
 */
const ACM_REGION = 'us-east-1';

interface Summary {
  CertificateArn: string;
  DomainName: string;
  SubjectAlternativeNameSummaries?: string[];
  Status: string;
}

interface ValidationRecord {
  Name: string;
  Type: string;
  Value: string;
}

export class AcmCertificates implements Certificates {
  constructor(
    private readonly aws: Aws,
    private readonly opts: {
      zoneFor: (host: string) => Promise<string>;
      pollMs: number;
      maxPolls: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  private acm(args: string[]) {
    return this.aws(['acm', ...args], { region: ACM_REGION });
  }

  /** 이 도메인 «만»의 인증서 — 발급된 것을 먼저, 없으면 검증 대기 중인 것 */
  private async find(host: string): Promise<Summary | undefined> {
    const r = (await this.acm(['list-certificates', '--certificate-statuses', 'ISSUED', 'PENDING_VALIDATION'])) as {
      CertificateSummaryList: Summary[];
    };
    const mine = r.CertificateSummaryList.filter(
      (c) => c.DomainName === host && (c.SubjectAlternativeNameSummaries ?? [host]).every((n) => n === host),
    );
    return mine.find((c) => c.Status === 'ISSUED') ?? mine.find((c) => c.Status === 'PENDING_VALIDATION');
  }

  async issued(host: string) {
    return (await this.find(host))?.Status === 'ISSUED';
  }

  async arnFor(host: string): Promise<string> {
    const c = await this.find(host);
    if (c?.Status !== 'ISSUED') throw new Error(`${host} 의 발급된 인증서가 없다`);
    return c.CertificateArn;
  }

  async request(host: string) {
    let arn = (await this.find(host))?.CertificateArn;
    if (!arn) {
      // 같은 토큰의 요청은 한 시간 안엔 같은 인증서를 돌려준다 — 요청 직후 죽은 실행이 두 장을 만들지 않게.
      const token = createHash('sha256').update(host).digest('hex').slice(0, 32);
      const made = (await this.acm([
        'request-certificate',
        '--domain-name',
        host,
        '--validation-method',
        'DNS',
        '--idempotency-token',
        token,
      ])) as { CertificateArn: string };
      arn = made.CertificateArn;
    }

    let recordPlaced = false;
    for (let i = 0; i < this.opts.maxPolls; i++) {
      const { status, record } = await this.describe(arn);
      if (status === 'ISSUED') return;
      if (status !== 'PENDING_VALIDATION')
        throw new Error(`${host} 인증서가 «${status}» 다 — ACM 콘솔에서 원인을 본다`);
      if (record && !recordPlaced) {
        await this.placeRecord(host, record);
        recordPlaced = true;
      }
      await (this.opts.sleep ?? defaultSleep)(this.opts.pollMs);
    }
    throw new StepPaused([
      `${host} 인증서가 아직 «검증 대기» 다 — Route53 검증 레코드는 넣었다. 몇 분 뒤 이 스크립트를 다시 돌리면 이어서 기다린다`,
      '   오래 안 풀리면 도메인 NS 가 Route53 존을 가리키는지 본다(27 사전 작업)',
    ]);
  }

  private async describe(arn: string): Promise<{ status: string; record?: ValidationRecord }> {
    const r = (await this.acm(['describe-certificate', '--certificate-arn', arn])) as {
      Certificate: { Status: string; DomainValidationOptions?: { ResourceRecord?: ValidationRecord }[] };
    };
    return { status: r.Certificate.Status, record: r.Certificate.DomainValidationOptions?.[0]?.ResourceRecord };
  }

  /** 검증 CNAME — 이미 같은 값이면 쓰지 않는다 */
  private async placeRecord(host: string, record: ValidationRecord) {
    const zone = await this.opts.zoneFor(host);
    const now = (await this.aws([
      'route53',
      'list-resource-record-sets',
      '--hosted-zone-id',
      zone,
      '--start-record-name',
      record.Name,
      '--start-record-type',
      record.Type,
      '--max-items',
      '1',
    ])) as { ResourceRecordSets: { Name: string; Type: string; ResourceRecords?: { Value: string }[] }[] };
    const same = now.ResourceRecordSets.some(
      (r) =>
        r.Name === record.Name && r.Type === record.Type && r.ResourceRecords?.some((v) => v.Value === record.Value),
    );
    if (same) return;
    await this.aws([
      'route53',
      'change-resource-record-sets',
      '--hosted-zone-id',
      zone,
      '--change-batch',
      JSON.stringify({
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: record.Name,
              Type: record.Type,
              TTL: 300,
              ResourceRecords: [{ Value: record.Value }],
            },
          },
        ],
      }),
    ]);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 호스트의 Route53 공개 존 — 가장 긴 접미사부터 찾는다. 없으면 null */
export async function findHostedZone(aws: Aws, host: string): Promise<string | null> {
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const name = `${labels.slice(i).join('.')}.`;
    let r: { HostedZones: { Id: string; Name: string; Config?: { PrivateZone?: boolean } }[] };
    try {
      r = (await aws(['route53', 'list-hosted-zones-by-name', '--dns-name', name, '--max-items', '1'])) as typeof r;
    } catch (e) {
      if (isAwsError(e, 'InvalidDomainName')) continue;
      throw e;
    }
    const zone = r.HostedZones.find((z) => z.Name === name && !z.Config?.PrivateZone);
    if (zone) return zone.Id.replace(/^\/hostedzone\//, '');
  }
  return null;
}

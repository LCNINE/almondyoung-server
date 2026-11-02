import { connect } from 'node:tls';
import type { TenantSlotSite } from '../../../../deployments/lcnine/tenant-domain-slots';
import type { Aws } from './aws-cli';

/**
 * 칸 켠 첫 배포 실측 중 스크립트가 잴 수 있는 셋(18 Answer 4·6·7). 나머지(diff 모양·sst 출력 순서·변경 없는 재배포)는
 * 배포 멈춤 지점이 사람에게 안내한다(`human-stops.deployTodo`).
 */
export interface SlotObservation {
  site: TenantSlotSite;
  host: string;
  /** TLS 인증서의 subjectAltName (`DNS:a, DNS:b`) */
  certSan: string;
  buildId: string;
  /** 같은 사이트의 아몬드영 주소 BUILD_ID */
  baseBuildId: string;
  /** 칸 배포의 무효화 수. 배포를 못 찾았으면 null */
  invalidations: number | null;
}

export function slotMeasurementProblems(observations: readonly SlotObservation[]): string[] {
  const problems: string[] = [];
  for (const o of observations) {
    const names = o.certSan
      .split(',')
      .map((s) => s.trim().replace(/^DNS:/, ''))
      .filter(Boolean);
    const others = names.filter((n) => n !== o.host);
    if (others.length > 0 || names.length === 0) {
      problems.push(
        `${o.host} 인증서 SAN 에 다른 이름: ${others.join(', ') || '(비었다)'} — 테넌트 이름만 있어야 한다`,
      );
    }
    if (o.buildId !== o.baseBuildId) {
      problems.push(
        `${o.host} BUILD_ID 가 ${o.site} 원 주소와 다르다 — 칸 무효화가 안 돌았거나 원본을 못 따라간다(18 실측 6)`,
      );
    }
    if (o.invalidations === null)
      problems.push(`CloudFront 배포 «${o.site} tenant slot» 을 못 찾았다 — 칸이 배포됐는지 본다`);
    else if (o.invalidations === 0)
      problems.push(`${o.host} 칸 배포의 무효화가 0건 — 무효화 명령 리소스가 안 돌았다(18 실측 4)`);
  }
  return problems;
}

/** 인증서 SAN — 검증은 하지 않고(이름만 본다) 접속 한 번 */
export function certSanOf(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15_000 }, () => {
      const san = socket.getPeerCertificate().subjectaltname ?? '';
      socket.end();
      resolve(san);
    });
    socket.on('error', reject);
    socket.on('timeout', () => socket.destroy(new Error(`${host}:443 접속 시간 초과`)));
  });
}

export async function buildIdOf(origin: string): Promise<string> {
  const res = await fetch(`${origin}/BUILD_ID`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${origin}/BUILD_ID → ${res.status}`);
  return (await res.text()).trim();
}

/** 칸 배포의 무효화 수 — 배포는 `tenant-domain-distribution.ts` 의 comment 로 찾는다 */
export async function slotInvalidations(aws: Aws, site: TenantSlotSite, slot: number): Promise<number | null> {
  const comment = `${site} tenant slot ${slot}`;
  const list = (await aws(['cloudfront', 'list-distributions'], { region: 'us-east-1' })) as {
    DistributionList?: { Items?: { Id: string; Comment: string }[] };
  };
  const id = list.DistributionList?.Items?.find((d) => d.Comment === comment)?.Id;
  if (!id) return null;
  const inv = (await aws(['cloudfront', 'list-invalidations', '--distribution-id', id], { region: 'us-east-1' })) as {
    InvalidationList?: { Quantity?: number; Items?: unknown[] };
  };
  // aws CLI v2 는 페이지를 자동으로 합치면서 Quantity 를 빼고 Items 만 준다 — Quantity 만 보면 언제나 0 이다.
  return inv.InvalidationList?.Items?.length ?? inv.InvalidationList?.Quantity ?? 0;
}

// 코드·IaC 배선 축 — DB 가 아니라 저장소 파일이 정본이라 파일을 읽어 본다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '../report';
import { channelInventoryIsManual, isPlaceholderEnv, isPlaceholderValue, linkedSecretValue, orderSourceWired } from '../rules';

const repo = join(__dirname, '../../../..');
const read = (path: string): string => readFileSync(join(repo, path), 'utf8');

export function checkWiring(r: Report): void {
  r.section('배선 1. 배포 IaC (deployments/lcnine/services/infra/services.ts)');
  const iac = read('deployments/lcnine/services/infra/services.ts');
  if (/HANJIN_/.test(iac)) r.ok('Core 에 HANJIN_* 배선 있음');
  else
    r.bad(
      'Core 태스크에 HANJIN_* 가 배선돼 있지 않다 → 운송장 발급 409 WAYBILL_CARRIER_NOT_CONFIGURED',
      'services.ts Core env 에 한진 키(시크릿) 배선 (#910)',
    );
  const market = [
    ['NAVER_CLIENT_ID', '#1244'],
    ['NAVER_API_ENDPOINT', '#1244'],
  ] as const;
  for (const [key, issue] of market) {
    if (isPlaceholderEnv(iac, key))
      r.bad(`${key} 가 자리표시 값이다 — 이 채널은 동작하지 않는다`, `sst.Secret 으로 배선 (${issue})`);
    else r.ok(`${key} 자리표시 값 아님`);
  }
  // 쿠팡 자격증명은 IaC 에 Secret 으로 배선돼 있어 텍스트로는 자리표시를 못 가린다 — 실제 Secret 값을 본다(값은 찍지 않는다).
  for (const name of ['CoupangAccessKey', 'CoupangSecretKey', 'CoupangVendorId']) {
    const value = linkedSecretValue(name);
    if (value === null) r.info(`쿠팡 자격증명 ${name} 못 잼 — services sst shell 에서 다시`);
    else if (isPlaceholderValue(value))
      r.bad(
        `쿠팡 자격증명 ${name} 이 자리표시 값이다 — 쿠팡 주문이 들어오지 않는다`,
        `npx sst secret set ${name} <값> --stage live 뒤 services 재배포 (#1245)`,
      );
    else r.ok(`쿠팡 자격증명 ${name} 실제 값`);
  }

  r.section('배선 2. 채널 어댑터 코드');
  const module = read('apps/channel-adapter/src/adapter.module.ts');
  for (const [source, issue] of [
    ['NaverOrderSource', '#1244'],
    ['CoupangOrderSource', '#1245'],
  ] as const) {
    if (orderSourceWired(module, source)) r.ok(`주문 수집 source 배선: ${source}`);
    else r.bad(`주문 수집 source 가 없다: ${source} — 그 채널 주문이 들어오지 않는다`, issue);
  }
  const capabilities = read('apps/channel-adapter/src/services/channel-capabilities.ts');
  for (const channel of ['naver', 'coupang']) {
    if (channelInventoryIsManual(capabilities, channel))
      r.bad(`${channel} 재고·품절 반영이 manual — 셀메이트를 끊으면 마켓에 품절이 안 간다`, '#1246');
    else r.ok(`${channel} 재고 반영 배선됨`);
  }
}

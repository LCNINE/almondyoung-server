import { SeedStep } from '../steps/base-seed-step';
import { WmsSeedStep } from '../steps/wms.seed-step';
import { PimSeedStep } from '../steps/pim.seed-step';
import { ProductMatchingBackfillSeedStep } from '../steps/product-matching-backfill.seed-step';
import { ReplenishmentSeedStep } from '../steps/replenishment.seed-step';
import { DemoLogisticsSeedStep } from '../steps/demo-logistics.seed-step';
import { ALL_TENANTS_SEED_GROUP } from './seed-groups';

/**
 * core(catalog+inventory 통합) DB 에 붙는 시드 스텝. 어느 갈래인지는 각 스텝의 `groups` 가 정한다(`seed-groups.ts`).
 * `tenantOneData: false`(테넌트 1 이 아닌 core DB)면 «모든 테넌트» 갈래 스텝만 남긴다 — 창고·자사몰·백필·데모는
 * 테넌트 1 의 데이터라 새 테넌트 DB 에 들어가면 그 테넌트가 남의 창고·채널을 갖고 태어난다.
 */
export function buildCoreSeedSteps(
  coreDbUrl: string,
  options: { tenantOneData: boolean } = { tenantOneData: true },
): SeedStep[] {
  const steps: SeedStep[] = [
    new WmsSeedStep(coreDbUrl),
    new PimSeedStep(coreDbUrl),
    new ProductMatchingBackfillSeedStep(coreDbUrl),
    new ReplenishmentSeedStep(coreDbUrl),
    new DemoLogisticsSeedStep(coreDbUrl),
  ];
  if (options.tenantOneData) return steps;
  const kept: SeedStep[] = [];
  for (const s of steps) {
    if (s.groups.includes(ALL_TENANTS_SEED_GROUP)) kept.push(s);
    // 버리는 스텝의 클라이언트는 아직 접속 전이다(postgres.js 는 첫 쿼리에 붙는다) — 닫기만 하고 기다리지 않는다.
    else void s.dispose();
  }
  return kept;
}

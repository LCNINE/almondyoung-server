import { SeedStep } from '../steps/base-seed-step';
import { WmsSeedStep } from '../steps/wms.seed-step';
import { PimSeedStep } from '../steps/pim.seed-step';
import { ProductMatchingBackfillSeedStep } from '../steps/product-matching-backfill.seed-step';
import { ReplenishmentSeedStep } from '../steps/replenishment.seed-step';
import { DemoLogisticsSeedStep } from '../steps/demo-logistics.seed-step';

/** core(catalog+inventory 통합) DB 에 붙는 시드 스텝. 어느 갈래인지는 각 스텝의 `groups` 가 정한다(`seed-groups.ts`). */
export function buildCoreSeedSteps(coreDbUrl: string): SeedStep[] {
  return [
    new WmsSeedStep(coreDbUrl),
    new PimSeedStep(coreDbUrl),
    new ProductMatchingBackfillSeedStep(coreDbUrl),
    new ReplenishmentSeedStep(coreDbUrl),
    new DemoLogisticsSeedStep(coreDbUrl),
  ];
}

import { WOWPRESS_PRODUCTS } from './wowpress-products';
import { type WowpressLineSpec } from './wowpress.types';

// apps/ugc-service/src/almond-template/constants/almond-template.constants.ts 의 ALMOND_PRINT_MIN_DPI/MAX_DPI 와 같아야 한다
const UGC_MIN_DPI = 150;
const UGC_MAX_DPI = 700;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problems(key: string, spec: WowpressLineSpec): string[] {
  const out: string[] = [];
  if (!UUID.test(key)) out.push(`${key}: key is not a uuid`);
  if (!Number.isInteger(spec.prodno) || spec.prodno <= 0) out.push(`${key}: prodno must be > 0`);
  if (!Number.isInteger(spec.qtyPerUnit) || spec.qtyPerUnit < 1) out.push(`${key}: qtyPerUnit must be >= 1`);
  if (spec.file.dpi < UGC_MIN_DPI || spec.file.dpi > UGC_MAX_DPI) out.push(`${key}: dpi out of ugc range`);
  return out;
}

describe('WOWPRESS_PRODUCTS guard', () => {
  it('every entry has a uuid key, prodno > 0, qtyPerUnit >= 1 and a dpi ugc accepts', () => {
    const all = Object.entries(WOWPRESS_PRODUCTS).flatMap(([key, spec]) => problems(key, spec));
    expect(all).toEqual([]);
  });

  it('the guard rejects a bad entry', () => {
    const bad: WowpressLineSpec = {
      prodno: 0,
      jobpresetno: '',
      prsjob: [],
      awkjob: [],
      qtyPerUnit: 0,
      file: { format: 'jpg', dpi: 900 },
      confirmed: false,
    };
    expect(problems('not-a-uuid', bad)).toHaveLength(4);
  });
});

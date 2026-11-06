import { type WowpressLineSpec } from '../wowpress/wowpress.types';
import { rowToSpec, specToRow } from './print-product-spec.repository';

const VARIANT = '0190f1d2-0000-7000-8000-00000000a001';

const SPEC: WowpressLineSpec = {
  prodno: 40001,
  jobpresetno: '1234',
  prsjob: [{ jobno: 1, jobname: 'front' }],
  awkjob: [{ jobno: 2 }],
  qtyPerUnit: 100,
  file: { format: 'pdf', dpi: 300 },
  design: { productId: 'design-product', widthMm: 90, heightMm: 50 },
  confirmed: true,
};

describe('print product spec row conversion', () => {
  it('round-trips every field of a line spec', () => {
    const row = specToRow(VARIANT, SPEC);

    expect(
      rowToSpec({ ...row, confirmedAt: null, confirmedBy: null, createdAt: new Date(), updatedAt: new Date() }),
    ).toEqual(SPEC);
  });

  it('maps each field to its column', () => {
    expect(specToRow(VARIANT, SPEC)).toEqual({
      variantId: VARIANT,
      prodno: 40001,
      jobpresetno: '1234',
      prsjob: [{ jobno: 1, jobname: 'front' }],
      awkjob: [{ jobno: 2 }],
      qtyPerUnit: 100,
      fileFormat: 'pdf',
      fileDpi: 300,
      designProductId: 'design-product',
      designWidthMm: 90,
      designHeightMm: 50,
      confirmed: true,
    });
  });
});

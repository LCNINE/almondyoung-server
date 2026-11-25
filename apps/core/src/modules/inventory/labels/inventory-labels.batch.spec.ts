import { BadRequestError } from '@app/shared';
import { SvgRasterizer } from '../../../platform/label/svg-rasterizer';
import { buildLabelBatch, type LabelCandidate } from './inventory-labels.batch';
import { renderSkuLabel } from './label-templates';

describe('buildLabelBatch', () => {
  const rasterizer = new SvgRasterizer();
  const candidate = (copies: number): LabelCandidate => ({
    ref: 'r',
    code: 'c',
    copies,
    render: () => ({ ok: false, reason: 'NOT_FOUND' }),
  });

  it.each([0, 201])('copies %i 은 BadRequestError 다', (copies) => {
    expect(() => buildLabelBatch([candidate(copies)], rasterizer)).toThrow(BadRequestError);
  });

  it('1×3 SKU 라벨을 300dpi(12 dot/mm)로 내고, 바코드 좌우에 quiet zone 이 남게 가운데에 둔다', () => {
    const batch = buildLabelBatch(
      [
        {
          ref: 'r',
          code: 'c',
          copies: 1,
          render: () => renderSkuLabel('30x10', { name: '테스트 상품', barcode: '13299420002' }),
        },
      ],
      rasterizer,
    );

    expect(batch.data).toContain('^XA\n^PW360');
    expect(batch.data).not.toContain('^MM');
    expect(batch.data).toContain('^LL120');
    // 112 모듈 × 2 dot = 224dot, 좌우 (360 − 224) / 2 = 68dot ≥ 모듈 × 10
    expect(batch.data).toContain('^FO68,7^BY2^BCN,60,');
  });
});

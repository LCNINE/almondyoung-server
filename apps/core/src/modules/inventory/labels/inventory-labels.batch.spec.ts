import { BadRequestError } from '@app/shared';
import { SvgRasterizer } from '../../../platform/label/svg-rasterizer';
import { buildLabelBatch, type LabelCandidate } from './inventory-labels.batch';

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
});

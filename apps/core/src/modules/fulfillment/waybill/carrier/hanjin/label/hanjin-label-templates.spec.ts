import { PRINTER_MAX_WIDTH_MM } from '../../../label/label-model';
import { HANJIN_LABEL_FIXTURE as DATA } from './__support__/hanjin-label-fixture';
import { HANJIN_LABEL_TEMPLATES, HANJIN_LABEL_TYPES, renderHanjinLabel } from './hanjin-label-templates';

describe('hanjin-label-templates', () => {
  it('세 형이 모두 등록돼 있다', () => {
    expect([...HANJIN_LABEL_TYPES]).toEqual(['NS', 'NL', 'FS']);
    expect(Object.keys(HANJIN_LABEL_TEMPLATES).sort()).toEqual(['FS', 'NL', 'NS']);
  });

  it.each([
    ['NS', 200, 102, 90],
    ['NL', 100, 102, 0],
    ['FS', 123, 100, 270],
  ] as const)('%s: %d × %dmm, rotation %d', (type, w, h, rotation) => {
    const spec = renderHanjinLabel(type, DATA);
    expect([spec.widthMm, spec.heightMm, spec.rotation]).toEqual([w, h, rotation]);
  });

  it.each(HANJIN_LABEL_TYPES)('%s: 프린터에 넣는 방향의 폭이 108mm 이하다', (type) => {
    const spec = renderHanjinLabel(type, DATA);
    const fedWidthMm = spec.rotation === 0 ? spec.widthMm : spec.heightMm;
    expect(fedWidthMm).toBeLessThanOrEqual(PRINTER_MAX_WIDTH_MM);
  });

  it('모르는 형은 설정 오류로 던진다 — 값과 허용값을 메시지에 적는다', () => {
    expect(() => renderHanjinLabel('XX', DATA)).toThrow('unknown HANJIN_LABEL_TYPE "XX" (expected NS|NL|FS)');
  });

  it('Object.prototype 의 키(constructor 등)도 모르는 형이다', () => {
    expect(() => renderHanjinLabel('constructor', DATA)).toThrow(/unknown HANJIN_LABEL_TYPE/);
  });
});

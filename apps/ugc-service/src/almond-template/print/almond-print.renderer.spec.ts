import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { ServiceUnavailableError } from '@app/shared';
import { AlmondPrintRenderer } from './almond-print.renderer';

function hasBinary(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfBinaries = hasBinary('gs') && hasBinary('rsvg-convert') ? describe : describe.skip;

const side = (label: string, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="94mm" height="54mm" viewBox="0 0 94 54">` +
  `<rect width="94" height="54" fill="${color}"/>` +
  `<text x="10" y="30" font-size="8" font-family="'Noto Sans CJK KR', sans-serif">${label}</text></svg>`;

const configOf = (values: Record<string, string>): ConfigService => new ConfigService(values);

describeIfBinaries('AlmondPrintRenderer (실제 gs·rsvg-convert)', () => {
  const renderer = new AlmondPrintRenderer(configOf({}));

  it('양면을 한 장짜리 EPS 로, 글꼴 없이 CMYK 로 만든다', async () => {
    const eps = (await renderer.renderEps(side('앞면 아몬드', '#ff6600'), side('뒷면', '#ffffff'))).toString('latin1');
    expect(eps.startsWith('%!PS-Adobe')).toBe(true);
    expect(eps).toMatch(/%%BoundingBox: 0 0 56[0-9] 15[0-9]/);
    expect(eps).not.toMatch(/^BT$/m);
    expect(eps).not.toMatch(/ Tf$/m);
    expect(eps).not.toMatch(/ (?:rg|RG)$/m);
    expect(eps).toMatch(/ k$/m);
  }, 60_000);

  it('양면을 두 쪽 PDF 로 만든다', async () => {
    const pdf = (await renderer.renderPdf(side('앞면', '#000000'), side('뒷면', '#ffffff'))).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toMatch(/\/Count 2/);
    expect(pdf).not.toContain('/FontFile');
  }, 60_000);

  it('동시에 불러도 차례로 끝낸다', async () => {
    const results = await Promise.all([
      renderer.renderPdf(side('하나', '#111111'), null),
      renderer.renderPdf(side('둘', '#222222'), null),
    ]);
    results.forEach((pdf) => expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF'));
  }, 60_000);
});

describe('AlmondPrintRenderer 변환기 없음', () => {
  it('바이너리가 없으면 503 으로 알린다', async () => {
    const renderer = new AlmondPrintRenderer(configOf({ RSVG_CONVERT_BIN: '/nonexistent/rsvg-convert' }));
    await expect(renderer.renderPdf(side('앞면', '#000000'), null)).rejects.toThrow(ServiceUnavailableError);
  });
});

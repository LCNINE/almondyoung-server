import { existsSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import { createBitmap, setBit, type MonoBitmap } from './label-model';

export const LABEL_FONT_FILES = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'] as const;

/**
 * 번들 폰트 디렉터리. 배포 이미지는 빌드 산출물(dist)에만 폰트가 있고(nest-cli assets),
 * 개발 모드·jest 는 소스 경로를 쓴다. 폰트 파일이 전부 있는 첫 후보를 고른다.
 */
export function resolveLabelFontDir(cwd: string = process.cwd(), exists: (p: string) => boolean = existsSync): string {
  const candidates = [join(cwd, 'dist/apps/core/assets/fonts'), join(cwd, 'apps/core/assets/fonts')];
  const found = candidates.find((dir) => LABEL_FONT_FILES.every((f) => exists(join(dir, f))));
  if (!found) throw new Error(`label fonts not found: looked in ${candidates.join(', ')}`);
  return found;
}

/**
 * SVG → 1비트 비트맵. resvg 를 감싸는 유일한 네이티브 경계다(#913).
 *
 * 시스템 폰트를 끄고 번들 나눔고딕만 쓰므로 어느 머신에서 돌려도 결과가 같다. 폰트가 없으면
 * 라벨 요청만 실패시킨다 — 라벨 기능 하나로 core 부팅을 막지 않는다.
 */
export class SvgRasterizer {
  private fontFiles?: string[];

  constructor(private readonly resolveFontDir: () => string = () => resolveLabelFontDir()) {}

  rasterize(svg: string, widthDots: number): MonoBitmap {
    const rendered = new Resvg(svg, {
      background: 'white',
      fitTo: { mode: 'width', value: widthDots },
      font: { loadSystemFonts: false, fontFiles: this.fonts(), defaultFontFamily: 'NanumGothic' },
    }).render();
    const { width, height, pixels } = rendered;
    const bitmap = createBitmap(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        if (luminance < 128) setBit(bitmap, x, y);
      }
    }
    return bitmap;
  }

  private fonts(): string[] {
    if (!this.fontFiles) {
      const dir = this.resolveFontDir();
      this.fontFiles = LABEL_FONT_FILES.map((f) => join(dir, f));
    }
    return this.fontFiles;
  }
}

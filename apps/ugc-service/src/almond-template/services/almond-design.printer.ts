import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ALMOND_PRINT_MAX_JPG_PIXELS, ALMOND_PRINT_SIDE_GAP_MM } from '../constants/almond-template.constants';
import { PublicFileClient } from '../clients/public-file.client';
import { extractPublicFileIds, inlinePublicImages, readSvgSizeMm } from '../print/almond-print-svg';
import { almondFontFamily, extractAlmondFontFileIds } from '../print/almond-print-fonts';
import { type AlmondPrintFont, AlmondPrintRenderer } from '../print/almond-print.renderer';
import {
  type AlmondDesignPrintSource,
  type AlmondPrintFile,
  type AlmondPrintFormat,
} from '../types/almond-design.types';

const CONTENT_TYPES: Record<AlmondPrintFormat, string> = {
  eps: 'application/postscript',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
};

@Injectable()
export class AlmondDesignPrinter {
  constructor(
    private readonly files: PublicFileClient,
    private readonly renderer: AlmondPrintRenderer,
  ) {}

  async print(source: AlmondDesignPrintSource, format: AlmondPrintFormat, dpi: number): Promise<AlmondPrintFile> {
    if (format === 'jpg') this.assertJpgSize(source, dpi);
    const [front, back] = await this.inline(source);
    const fonts = await this.fonts([front, back]);
    const body =
      format === 'eps'
        ? await this.renderer.renderEps(front, back, fonts)
        : format === 'pdf'
          ? await this.renderer.renderPdf(front, back, fonts)
          : await this.renderer.renderJpg(front, back, dpi, fonts);

    return { fileName: `almond-design-${source.id}.${format}`, contentType: CONTENT_TYPES[format], body };
  }

  async preview(source: AlmondDesignPrintSource, side: 'front' | 'back'): Promise<Buffer | null> {
    const svg = side === 'front' ? source.frontSvg : source.backSvg;
    if (svg === null) return null;
    const [inlined] = await this.inline({ ...source, frontSvg: svg, backSvg: null });
    return this.renderer.renderPreview(inlined, await this.fonts([inlined]));
  }

  private async fonts(svgs: Array<string | null>): Promise<AlmondPrintFont[]> {
    const fileIds = [...new Set(svgs.flatMap((svg) => (svg === null ? [] : extractAlmondFontFileIds(svg))))];
    const fonts: AlmondPrintFont[] = [];
    for (const fileId of fileIds) {
      const { bytes, format } = await this.files.fetchFont(fileId);
      // 글꼴 없이 그리면 기본 고딕으로 조용히 바뀐 인쇄물이 나가므로 실패시킨다
      if (!format) throw new Error(`인쇄에 쓸 글꼴 파일이 아닙니다: ${fileId}`);
      fonts.push({ family: almondFontFamily(fileId), bytes, format });
    }
    return fonts;
  }

  private async inline(source: AlmondDesignPrintSource): Promise<[string, string | null]> {
    const svgs = source.backSvg === null ? [source.frontSvg] : [source.frontSvg, source.backSvg];
    const fileIds = [...new Set(svgs.flatMap(extractPublicFileIds))];
    const dataUris = new Map<string, string>();
    for (const fileId of fileIds) {
      dataUris.set(fileId, await this.files.fetchImageDataUri(fileId));
    }
    return [
      inlinePublicImages(source.frontSvg, dataUris),
      source.backSvg === null ? null : inlinePublicImages(source.backSvg, dataUris),
    ];
  }

  private assertJpgSize(source: AlmondDesignPrintSource, dpi: number): void {
    const front = readSvgSizeMm(source.frontSvg);
    const back = source.backSvg === null ? null : readSvgSizeMm(source.backSvg);
    if (!front) return;
    const widthMm = front.width + (back ? ALMOND_PRINT_SIDE_GAP_MM + back.width : 0);
    const heightMm = Math.max(front.height, back?.height ?? 0);
    const pixels = ((widthMm * dpi) / 25.4) * ((heightMm * dpi) / 25.4);
    if (pixels > ALMOND_PRINT_MAX_JPG_PIXELS) {
      throw new BadRequestError(`${dpi}dpi 로는 이미지가 너무 큽니다. dpi 를 낮춰 주세요.`);
    }
  }
}

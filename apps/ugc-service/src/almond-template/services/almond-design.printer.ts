import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ALMOND_PRINT_MAX_JPG_PIXELS, ALMOND_PRINT_SIDE_GAP_MM } from '../constants/almond-template.constants';
import { PublicFileClient } from '../clients/public-file.client';
import { extractPublicFileIds, inlinePublicImages, readSvgSizeMm } from '../print/almond-print-svg';
import { AlmondPrintRenderer } from '../print/almond-print.renderer';
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
    const body =
      format === 'eps'
        ? await this.renderer.renderEps(front, back)
        : format === 'pdf'
          ? await this.renderer.renderPdf(front, back)
          : await this.renderer.renderJpg(front, back, dpi);

    return { fileName: `almond-design-${source.id}.${format}`, contentType: CONTENT_TYPES[format], body };
  }

  async preview(source: AlmondDesignPrintSource, side: 'front' | 'back'): Promise<Buffer | null> {
    const svg = side === 'front' ? source.frontSvg : source.backSvg;
    if (svg === null) return null;
    const [inlined] = await this.inline({ ...source, frontSvg: svg, backSvg: null });
    return this.renderer.renderPreview(inlined);
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

import { Injectable } from '@nestjs/common';
import { PublicFileClient } from '../clients/public-file.client';
import { extractPublicFileIds, inlinePublicImages } from '../print/almond-print-svg';
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
    const svgs = source.backSvg === null ? [source.frontSvg] : [source.frontSvg, source.backSvg];
    const fileIds = [...new Set(svgs.flatMap(extractPublicFileIds))];
    const dataUris = new Map<string, string>();
    for (const fileId of fileIds) {
      dataUris.set(fileId, await this.files.fetchImageDataUri(fileId));
    }

    const front = inlinePublicImages(source.frontSvg, dataUris);
    const back = source.backSvg === null ? null : inlinePublicImages(source.backSvg, dataUris);
    const body =
      format === 'eps'
        ? await this.renderer.renderEps(front, back)
        : format === 'pdf'
          ? await this.renderer.renderPdf(front, back)
          : await this.renderer.renderJpg(front, back, dpi);

    return { fileName: `almond-design-${source.id}.${format}`, contentType: CONTENT_TYPES[format], body };
  }
}

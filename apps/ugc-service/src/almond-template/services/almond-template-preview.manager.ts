import { Injectable } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { PrintFileClient } from '../clients/print-file.client';
import { withRootSizeMm } from '../print/almond-print-svg';
import { ALMOND_TEMPLATE_IMAGE_CONTEXT_ID } from '../constants/almond-template.constants';
import { AlmondDesignPrinter } from './almond-design.printer';
import { AlmondTemplateReader } from './almond-template.reader';

@Injectable()
export class AlmondTemplatePreviewManager {
  constructor(
    private readonly reader: AlmondTemplateReader,
    private readonly printer: AlmondDesignPrinter,
    private readonly files: PrintFileClient,
  ) {}

  async upload(id: string, accessToken: string): Promise<string> {
    const template = await this.reader.findById(id);
    const frontSvg = withRootSizeMm(template.thumbnailSvg, template.widthMm, template.heightMm);
    // 시안 한 면을 기존 미리보기 JPG 렌더러로 그려 상품 이미지용 공개 컨텍스트에 올린다
    const jpg = await this.printer.preview({ id, frontSvg, backSvg: null }, 'front');
    if (!jpg) throw new UpstreamUnavailableError('미리보기 이미지를 만들지 못했습니다.');

    return this.files.upload(jpg, `almond-template-${id}.jpg`, 'image/jpeg', accessToken, {
      contextId: ALMOND_TEMPLATE_IMAGE_CONTEXT_ID,
      isPublic: true,
    });
  }
}

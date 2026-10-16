import { BadRequestException } from '@nestjs/common';
import { ALMOND_PRINT_MAX_DPI, ALMOND_PRINT_MIN_DPI } from '../constants/almond-template.constants';
import { type AlmondPrintFormat } from '../types/almond-design.types';

export function parsePrintFormatAndDpi(format: string, dpi: number): { format: AlmondPrintFormat; dpi: number } {
  if (format !== 'pdf' && format !== 'eps' && format !== 'jpg') {
    throw new BadRequestException('format 은 pdf·eps·jpg 중 하나여야 합니다.');
  }
  if (dpi < ALMOND_PRINT_MIN_DPI || dpi > ALMOND_PRINT_MAX_DPI) {
    throw new BadRequestException(`dpi 는 ${ALMOND_PRINT_MIN_DPI}~${ALMOND_PRINT_MAX_DPI} 사이여야 합니다.`);
  }
  return { format, dpi };
}

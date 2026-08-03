import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** 한 양식이 담을 수 있는 상품 수 상한. 워크북 파일 크기와 조립 시간의 실용 상한이다. */
export const MAX_FORM_EXPORT_PRODUCTS = 5000;

export class CreateFormExportDto {
  @ApiProperty({ description: '양식에 프리필할 상품 masterId 목록', type: [String] })
  @IsArray()
  @ArrayNotEmpty({ message: '상품을 한 개 이상 선택해 주세요.' })
  @ArrayMaxSize(MAX_FORM_EXPORT_PRODUCTS, {
    message: `한 번에 최대 ${MAX_FORM_EXPORT_PRODUCTS}개까지 선택할 수 있습니다.`,
  })
  @IsUUID('all', { each: true })
  masterIds: string[];
}

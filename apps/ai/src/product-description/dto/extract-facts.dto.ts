import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { IMAGES_PER_CHUNK } from '@packages/product-description';

export class ExtractFactsDto {
  @ApiProperty({
    description: `분석할 이미지의 fileId. 한 번에 ${IMAGES_PER_CHUNK}장까지 — 그 이상은 클라이언트가 청크로 나눠 보낸다.`,
    type: [String],
    maxItems: IMAGES_PER_CHUNK,
  })
  @IsArray()
  @ArrayNotEmpty({ message: '이미지를 1장 이상 첨부해주세요.' })
  @ArrayMaxSize(IMAGES_PER_CHUNK, {
    message: `한 번에 분석할 수 있는 이미지는 ${IMAGES_PER_CHUNK}장까지입니다.`,
  })
  @IsString({ each: true })
  fileIds: string[];
}

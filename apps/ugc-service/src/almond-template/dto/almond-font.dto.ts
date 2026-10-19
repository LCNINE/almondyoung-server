import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ALMOND_FONT_MAX_NAME_LENGTH } from '../constants/almond-template.constants';

export class CreateAlmondFontDto {
  @ApiProperty({ description: 'file-service 의 almond-template-font 컨텍스트로 올린 파일', format: 'uuid' })
  @IsUUID()
  fileId: string;

  @ApiProperty({ description: '글꼴 목록에 보일 이름', maxLength: ALMOND_FONT_MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(ALMOND_FONT_MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({
    description: '상업적 이용과 웹 임베딩(고객 브라우저로 배포)이 허용된 글꼴임을 올린 사람이 확인했다',
    enum: [true],
  })
  @Equals(true, { message: '상업적 이용·웹 임베딩이 가능한 글꼴인지 확인해 주세요.' })
  licenseConfirmed: true;
}

export class AlmondFontResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ format: 'uuid' }) fileId: string;
  @ApiProperty({
    description: '화면·인쇄에서 쓰는 CSS font-family 이름',
    example: 'AF0199a1b2c3d4e5f60718293a4b5c6d7e',
  })
  family: string;
  @ApiProperty({ enum: ['ttf', 'otf', 'woff', 'woff2'] }) format: string;
}

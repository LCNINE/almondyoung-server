import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class InternalContactsRequestDto {
  @ApiProperty({
    type: [String],
    description: '연락처를 조회할 userId 목록',
    example: ['3f9a...', '7c21...'],
  })
  @IsArray()
  @ArrayNotEmpty()
  // 한 번에 긁어갈 수 있는 양의 상한. 크론 배치가 이보다 크면 호출자가 청크로 나눈다.
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  userIds: string[];
}

import { ApiProperty } from '@nestjs/swagger';

export class RolePermissionsSnapshotDto {
  @ApiProperty({ description: '내용에서 계산한 버전. 바뀌지 않았으면 If-None-Match 로 304 를 받는다' })
  version!: string;

  // 키가 역할 이름인 사전이라 중첩 DTO 클래스로 표현할 수 없다.
  @ApiProperty({
    type: 'object',
    description: '역할 이름 → 권한 키 목록. 고객 역할은 없다. master 는 활성 권한 전체',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  roles!: Record<string, string[]>;
}

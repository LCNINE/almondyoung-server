import { ApiProperty } from '@nestjs/swagger';

export class MyRoleDto {
  @ApiProperty() name!: string;
  @ApiProperty({ description: '화면 표시 이름. 없으면 name' }) displayName!: string;
}

export class MyPermissionsResponseDto {
  @ApiProperty({ type: [MyRoleDto] }) roles!: MyRoleDto[];
  @ApiProperty({ type: [String], description: '이 사용자가 가진 권한 키(역할 합집합)' }) permissions!: string[];
  @ApiProperty({ description: '역할별 권한 내용의 버전' }) version!: string;
}

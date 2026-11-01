import { ApiProperty } from '@nestjs/swagger';
import { tenantStatusEnum } from 'apps/user-service/database/drizzle/schema';

export class TenantStatusDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: tenantStatusEnum.enumValues })
  status!: (typeof tenantStatusEnum.enumValues)[number];
}

/** core 의 정지 스위치가 받아 가는 테넌트 상태. 이름·로고·도메인은 싣지 않는다. */
export class TenantStatusesDto {
  @ApiProperty({ type: [TenantStatusDto] })
  tenants!: TenantStatusDto[];
}

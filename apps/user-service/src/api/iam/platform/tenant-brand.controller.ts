import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../commons/decorator/public.decorator';
import { TenantBrandDto, TenantBrandQueryDto } from './dto/platform.dto';
import { PlatformService } from './platform.service';

/** 로그인 전에 그 주소의 브랜드를 그리려고 auth-web·admin-web 서버가 토큰 없이 부른다. */
@ApiTags('Tenant brand')
@Controller('tenant-brand')
export class TenantBrandController {
  constructor(private readonly service: PlatformService) {}

  @ApiOperation({ summary: '주소 → 테넌트 브랜드(이름·로고·활성 여부). 모르는 주소는 404' })
  @Public()
  @Get()
  brand(@Query() query: TenantBrandQueryDto): Promise<TenantBrandDto> {
    return this.service.brand(query.host);
  }
}

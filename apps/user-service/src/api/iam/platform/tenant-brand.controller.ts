import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../commons/decorator/public.decorator';
import { OAuthInternalSecretGuard } from '../../../commons/guards/oauth-internal-secret.guard';
import { TenantBrandDto, TenantBrandQueryDto, TenantSiteDto } from './dto/platform.dto';
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

  /**
   * auth-web 서버 전용(`x-internal-secret`) — 브랜드에 테넌트 id 와 그 테넌트의 도메인 전부를 더한다. auth-web 이 테넌트 화면의
   * 리디렉트를 그 도메인 안에 가둔다. 다른 도메인이 보이므로 공개 조회에는 싣지 않는다.
   */
  @ApiExcludeEndpoint()
  @Public()
  @UseGuards(OAuthInternalSecretGuard)
  @Get('site')
  site(@Query() query: TenantBrandQueryDto): Promise<TenantSiteDto> {
    return this.service.site(query.host);
  }
}

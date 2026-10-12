import type { JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MyPermissionsResponseDto } from './dto/my-permissions.dto';
import { IamService } from './iam.service';
import { StoreRoute } from '@app/authorization';

@ApiTags('Me')
@ApiBearerAuth('access-token')
@Controller('me')
export class MePermissionsController {
  constructor(private readonly iamService: IamService) {}

  @ApiOperation({
    summary: '내 역할과 권한',
    description: '관리자 화면의 메뉴·라우트·버튼 판정에 쓴다. 역할은 토큰 기준',
  })
  @ApiResponse({ status: 200, type: MyPermissionsResponseDto })
  @StoreRoute()
  @Get('permissions')
  getMyPermissions(@CurrentUser() user: JwtPayload): Promise<MyPermissionsResponseDto> {
    return this.iamService.forRoles(user.roles ?? []);
  }
}

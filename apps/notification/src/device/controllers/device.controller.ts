import { Body, Controller, Delete, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@app/authorization';
import { JwtUserGuard, UserId } from '../guards/jwt-user.guard';
import { DeviceService } from '../services/device.service';
import { DeactivateFcmTokenDto, RegisterFcmTokenDto } from '../dto/register-token.dto';

@ApiTags('devices')
// 스토어프론트(고객)가 FCM 토큰을 등록하는 경로다 — 직원 역할을 요구하면 안 된다.
// 인증은 아래 JwtUserGuard 가 자체 시크릿(JWT_ACCESS_SECRET)으로 따로 한다. 그 시크릿은 현재
// 배포 env 에 없어서 이 두 라우트는 항상 401 이다 — 이 커밋은 그 동작을 바꾸지 않는다.
@StoreRoute()
@Controller('devices')
@ApiBearerAuth('access-token')
@UseGuards(JwtUserGuard)
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('fcm-token')
  @ApiOperation({ summary: 'FCM 토큰 등록/갱신' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async registerToken(@UserId() userId: string, @Body(ValidationPipe) dto: RegisterFcmTokenDto): Promise<void> {
    await this.deviceService.registerToken(userId, dto);
  }

  @Delete('fcm-token')
  @ApiOperation({ summary: 'FCM 토큰 비활성화' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async deactivateToken(@UserId() userId: string, @Body(ValidationPipe) dto: DeactivateFcmTokenDto): Promise<void> {
    await this.deviceService.deactivateToken(userId, dto.token);
  }
}

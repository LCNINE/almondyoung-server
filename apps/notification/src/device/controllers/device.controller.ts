import { Body, Controller, Delete, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtUserGuard, UserId } from '../guards/jwt-user.guard';
import { DeviceService } from '../services/device.service';
import { DeactivateFcmTokenDto, RegisterFcmTokenDto } from '../dto/register-token.dto';

@ApiTags('devices')
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

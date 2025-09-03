import { AuthorizationGuard } from '@app/roles/guards/authorization-guard';
import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { ConsentsService } from './consents.service';
import { CreateConsentDto } from './dto/consent-dto';
import { UserConsent } from './types/consent.type';

@ApiTags('동의 관리')
@Controller('consents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @ApiOperation({ summary: '사용자 동의 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 동의 정보 조회 성공',
    type: CreateConsentDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 동의 정보를 찾을 수 없음',
  })
  @Get()
  async getConsents(@CurrentUser() user: User): Promise<UserConsent | null> {
    try {
      const userConsent = await this.consentsService.getUserConsent(user.id);
      if (!userConsent) {
        throw new NotFoundException('User consent not found');
      }
      return userConsent;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException({
        message: '사용자 동의 정보 조회 중 서버 오류가 발생했습니다.',
      });
    }
  }

  @ApiOperation({ summary: '사용자 동의 정보 생성' })
  @ApiResponse({
    status: 201,
    description: '사용자 동의 정보 생성 성공',
  })
  @Post()
  async createConsent(
    @CurrentUser() user: User,
    @Body() createConsentDto: CreateConsentDto,
  ): Promise<void> {
    return this.consentsService.createConsent(user.id, createConsentDto);
  }
}

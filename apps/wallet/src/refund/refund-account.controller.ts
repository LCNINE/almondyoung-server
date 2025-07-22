import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  RefundAccountService,
  CreateRefundAccountDto,
  UpdateRefundAccountDto,
} from './services/refund-account.service';

/**
 * 사용자 환불 계좌 관리 컨트롤러
 * - GET /users/refund-accounts: 환불 계좌 목록 조회
 * - POST /users/refund-accounts: 환불 계좌 등록
 * - GET /users/refund-accounts/:id: 환불 계좌 상세 조회
 * - PUT /users/refund-accounts/:id: 환불 계좌 수정
 * - DELETE /users/refund-accounts/:id: 환불 계좌 삭제
 * - GET /users/refund-accounts/default: 기본 환불 계좌 조회
 */
@Controller('refund-accounts')
export class RefundAccountController {
  private readonly logger = new Logger(RefundAccountController.name);

  constructor(private readonly refundAccountService: RefundAccountService) {}

  /**
   * 사용자의 환불 계좌 목록을 조회합니다.
   */
  @Get()
  async getUserRefundAccounts(@Query('userId') userId: string) {
    this.logger.log(`환불 계좌 목록 조회 API 호출: userId=${userId}`);

    try {
      return await this.refundAccountService.getUserRefundAccounts(userId);
    } catch (error) {
      this.logger.error('환불 계좌 목록 조회 API 오류:', error);
      return {
        success: false,
        message: '환불 계좌 목록 조회에 실패했습니다.',
      };
    }
  }

  /**
   * 새로운 환불 계좌를 등록합니다.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRefundAccount(
    @Body() createRefundAccountDto: CreateRefundAccountDto,
  ) {
    this.logger.log(
      `환불 계좌 등록 API 호출: userId=${createRefundAccountDto.userId}`,
    );

    try {
      const newAccount = await this.refundAccountService.createRefundAccount(
        createRefundAccountDto,
      );

      return {
        success: true,
        message: '환불 계좌가 등록되었습니다.',
        data: {
          id: newAccount.id,
          bankName: newAccount.bankName,
          accountHolderName: newAccount.accountHolderName,
          isDefault: newAccount.isDefault,
          createdAt: newAccount.createdAt,
        },
      };
    } catch (error) {
      this.logger.error('환불 계좌 등록 API 오류:', error);

      if (error.message.includes('duplicate')) {
        return {
          success: false,
          message: '이미 등록된 계좌입니다.',
        };
      }

      return {
        success: false,
        message: '환불 계좌 등록에 실패했습니다.',
      };
    }
  }

  /**
   * 기본 환불 계좌를 조회합니다.
   */
  @Get('default')
  async getDefaultRefundAccount(@Query('userId') userId: string) {
    this.logger.log(`기본 환불 계좌 조회 API 호출: userId=${userId}`);

    try {
      return await this.refundAccountService.getDefaultRefundAccount(userId);
    } catch (error) {
      this.logger.error('기본 환불 계좌 조회 API 오류:', error);
      return {
        success: false,
        message: '기본 환불 계좌 조회에 실패했습니다.',
      };
    }
  }

  /**
   * 특정 환불 계좌의 상세 정보를 조회합니다.
   */
  @Get(':id')
  async getRefundAccount(
    @Param('id') accountId: string,
    @Query('userId') userId: string,
  ) {
    this.logger.log(
      `환불 계좌 상세 조회 API 호출: userId=${userId}, accountId=${accountId}`,
    );

    try {
      return await this.refundAccountService.getRefundAccount(
        userId,
        accountId,
      );
    } catch (error) {
      this.logger.error('환불 계좌 상세 조회 API 오류:', error);

      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 계좌를 찾을 수 없습니다.',
        };
      }

      return {
        success: false,
        message: '환불 계좌 조회에 실패했습니다.',
      };
    }
  }

  /**
   * 환불 계좌 정보를 수정합니다.
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateRefundAccount(
    @Param('id') accountId: string,
    @Query('userId') userId: string,
    @Body() updateRefundAccountDto: UpdateRefundAccountDto,
  ) {
    this.logger.log(
      `환불 계좌 수정 API 호출: userId=${userId}, accountId=${accountId}`,
    );

    try {
      const updatedAccount =
        await this.refundAccountService.updateRefundAccount(
          userId,
          accountId,
          updateRefundAccountDto,
        );

      return {
        success: true,
        message: '환불 계좌가 수정되었습니다.',
        data: {
          id: updatedAccount.id,
          bankName: updatedAccount.bankName,
          accountHolderName: updatedAccount.accountHolderName,
          isDefault: updatedAccount.isDefault,
          updatedAt: updatedAccount.updatedAt,
        },
      };
    } catch (error) {
      this.logger.error('환불 계좌 수정 API 오류:', error);

      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 계좌를 찾을 수 없습니다.',
        };
      }

      return {
        success: false,
        message: '환불 계좌 수정에 실패했습니다.',
      };
    }
  }

  /**
   * 환불 계좌를 삭제합니다.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteRefundAccount(
    @Param('id') accountId: string,
    @Query('userId') userId: string,
  ) {
    this.logger.log(
      `환불 계좌 삭제 API 호출: userId=${userId}, accountId=${accountId}`,
    );

    try {
      return await this.refundAccountService.deleteRefundAccount(
        userId,
        accountId,
      );
    } catch (error) {
      this.logger.error('환불 계좌 삭제 API 오류:', error);

      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 계좌를 찾을 수 없습니다.',
        };
      }

      if (error.message.includes('환불 이력이 있는')) {
        return {
          success: false,
          message: '환불 이력이 있는 계좌는 삭제할 수 없습니다.',
        };
      }

      return {
        success: false,
        message: '환불 계좌 삭제에 실패했습니다.',
      };
    }
  }
}

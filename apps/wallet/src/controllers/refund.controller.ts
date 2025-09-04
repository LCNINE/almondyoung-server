import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { RefundService } from '../services/refund.service';
import {
  RefundRequestDto,
  RefundResponseDto,
} from '../shared/dtos/refunds/refund.dto';

@ApiTags('환불 (V2)')
@Controller('v2/refunds')
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  @Post()
  @ApiOperation({
    summary: '결제 환불 실행',
    description: `
결제 건에 대해 환불을 실행합니다.  
- 전체 환불 또는 부분 환불 가능  
- 결제 상태가 CAPTURED 상태여야 함
    `,
  })
  @ApiResponse({
    status: 200,
    description: '환불이 성공적으로 처리되었습니다.',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 데이터 또는 환불 처리 실패',
  })
  @ApiNotFoundResponse({
    description: '환불 대상 결제를 찾을 수 없음',
  })
  @ApiInternalServerErrorResponse({
    description: '서버 내부 오류',
  })
  async refund(@Body() dto: RefundRequestDto): Promise<RefundResponseDto> {
    try {
      this.logger.log(
        `환불 요청: paymentId=${dto.paymentSessionId}, amount=${dto.amount}`,
      );
      return await this.refundService.requestRefund(dto);
    } catch (error) {
      this.logger.error('환불 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (
        error.message?.includes('required') ||
        error.message?.includes('already processed') ||
        error.message?.includes('exceeds')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        '환불 처리 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

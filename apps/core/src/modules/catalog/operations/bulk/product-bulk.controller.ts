import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ProductBulkService } from './product-bulk.service';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto, BulkPolicyDto } from './dto';

@ApiTags('Product Bulk Operations')
@Controller('masters/bulk')
export class ProductBulkController {
  constructor(private bulkService: ProductBulkService) {}

  @Post('update')
  @ApiOperation({
    summary: '제품 일괄 수정',
    description: '여러 제품을 한 번에 수정합니다.',
  })
  @ApiBody({ type: BulkUpdateDto })
  @ApiResponse({ status: 200, description: '일괄 수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async bulkUpdate(@Body() dto: BulkUpdateDto, @User() user: { userId: string }) {
    try {
      return await this.bulkService.bulkUpdate(dto, user.userId);
    } catch (error) {
      throw new HttpException(`Failed to bulk update: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('delete')
  @ApiOperation({
    summary: '제품 일괄 소프트 삭제',
    description: '여러 제품을 한 번에 소프트 삭제합니다.',
  })
  @ApiBody({ type: BulkDeleteDto })
  @ApiResponse({ status: 200, description: '일괄 삭제 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async bulkDelete(@Body() dto: BulkDeleteDto, @User() user: { userId: string }) {
    try {
      return await this.bulkService.bulkSoftDelete(dto, user.userId);
    } catch (error) {
      throw new HttpException(`Failed to bulk delete: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('restore')
  @ApiOperation({
    summary: '제품 일괄 복원',
    description: '여러 삭제된 제품을 한 번에 복원합니다.',
  })
  @ApiBody({ type: BulkRestoreDto })
  @ApiResponse({ status: 200, description: '일괄 복원 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async bulkRestore(@Body() dto: BulkRestoreDto, @User() user: { userId: string }) {
    try {
      return await this.bulkService.bulkRestore(dto, user.userId);
    } catch (error) {
      throw new HttpException(`Failed to bulk restore: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('policy')
  @ApiOperation({
    summary: '운영 노출 정책 일괄 변경',
    description:
      '선택 상품의 운영 노출 정책(멤버십가 비공개/회원 전용 노출/해외직구)을 일괄 변경합니다. active 버전이 없는 상품은 실패 목록으로 반환됩니다.',
  })
  @ApiBody({ type: BulkPolicyDto })
  @ApiResponse({ status: 200, description: '일괄 변경 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async bulkUpdatePolicy(@Body() dto: BulkPolicyDto) {
    try {
      return await this.bulkService.bulkUpdatePolicy(dto);
    } catch (error) {
      throw new HttpException(`Failed to bulk update policy: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }
}

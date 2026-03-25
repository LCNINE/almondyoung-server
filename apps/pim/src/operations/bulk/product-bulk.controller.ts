import { Controller, Post, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { ProductBulkService } from './product-bulk.service';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto } from './dto';

@ApiTags('Product Bulk Operations')
@UseGuards(JwtAuthGuard)
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
}

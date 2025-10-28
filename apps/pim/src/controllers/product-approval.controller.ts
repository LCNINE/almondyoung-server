import { Controller, Post, Get, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { ProductApprovalService } from '../services/product-approval.service';

@ApiTags('Product Approval')
@Controller('masters')
export class ProductApprovalController {
  constructor(private approvalService: ProductApprovalService) {}

  @Post(':id/submit-approval')
  @ApiOperation({
    summary: '제품 승인 요청',
    description: '제품을 승인 대기 상태로 전환합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiBody({ schema: { properties: { userId: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: '승인 요청 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 (제품이 draft 상태가 아님)' })
  @ApiResponse({ status: 404, description: '제품을 찾을 수 없음' })
  async submitForApproval(
    @Param('id') productId: string,
    @Body('userId') userId: string,
  ) {
    try {
      return await this.approvalService.submitForApproval(productId, userId);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: '제품 승인',
    description: '제품을 승인하고 활성화합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiBody({ 
    schema: { 
      properties: { 
        userId: { type: 'string' },
        comment: { type: 'string', required: false }
      } 
    } 
  })
  @ApiResponse({ status: 200, description: '제품 승인 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '제품을 찾을 수 없음' })
  async approve(
    @Param('id') productId: string,
    @Body() body: { userId: string; comment?: string },
  ) {
    try {
      return await this.approvalService.approve(productId, body.userId, body.comment);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: '제품 거부',
    description: '제품을 거부하고 거부 사유를 기록합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiBody({ 
    schema: { 
      properties: { 
        userId: { type: 'string' },
        reason: { type: 'string' }
      } 
    } 
  })
  @ApiResponse({ status: 200, description: '제품 거부 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '제품을 찾을 수 없음' })
  async reject(
    @Param('id') productId: string,
    @Body() body: { userId: string; reason: string },
  ) {
    try {
      return await this.approvalService.reject(productId, body.userId, body.reason);
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('pending-approval')
  @ApiOperation({
    summary: '승인 대기 중인 제품 목록',
    description: '승인 대기 중인 제품 마스터 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '목록 조회 성공' })
  async getPendingApprovals() {
    try {
      return await this.approvalService.getPendingApprovals();
    } catch (error) {
      throw new HttpException(
        'Failed to get pending approvals',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/approval-history')
  @ApiOperation({
    summary: '제품 승인 이력',
    description: '제품의 승인 이력을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '제품 마스터 ID' })
  @ApiResponse({ status: 200, description: '이력 조회 성공' })
  async getApprovalHistory(@Param('id') productId: string) {
    try {
      return await this.approvalService.getApprovalHistory(productId);
    } catch (error) {
      throw new HttpException(
        'Failed to get approval history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}


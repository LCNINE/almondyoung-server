import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute, User } from '@app/authorization';
import { CustomerFileRejectionDto, ReuploadPrintFileDto } from '../dto/store-print-orders.dto';
import { StorePrintOrdersService } from '../services/store-print-orders.service';

interface AuthenticatedCustomer {
  userId: string;
}

@ApiTags('Store - Print Orders')
@StoreRoute()
@Controller('store/print-orders')
export class StorePrintOrdersController {
  constructor(private readonly service: StorePrintOrdersService) {}

  @Get('file-rejections')
  @ApiOperation({ summary: '다시 올려야 하는 내 인쇄 파일(알림 벨)' })
  fileRejections(@User() customer: AuthenticatedCustomer): Promise<CustomerFileRejectionDto[]> {
    return this.service.fileRejections(customer.userId);
  }

  @Post(':salesOrderLineId/file')
  @HttpCode(204)
  @ApiOperation({ summary: '파일 에러로 멈춘 인쇄 줄에 새 파일을 올린다' })
  reuploadFile(
    @Param('salesOrderLineId', ParseUUIDPipe) salesOrderLineId: string,
    @Body() body: ReuploadPrintFileDto,
    @User() customer: AuthenticatedCustomer,
  ): Promise<void> {
    return this.service.reuploadFile(customer.userId, salesOrderLineId, body.fileId);
  }
}

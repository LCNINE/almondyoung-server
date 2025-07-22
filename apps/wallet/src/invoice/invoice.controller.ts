import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';

import * as invoiceZod from '../shared/zod/invoice.zod';
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  create(@Body() createInvoiceDto: invoiceZod.Invoice['Create']) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('status') status?: invoiceZod.Invoice['Select']['status'],
  ) {
    return this.invoiceService.findAll(userId, status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: string) {
    return this.invoiceService.findOne(id);
  }

  @Get(':id/events')
  getInvoiceEvents(@Param('id') id: string) {
    return this.invoiceService.getInvoiceEvents(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: string,
    @Body() updateInvoiceStatusDto: invoiceZod.Invoice['UpdateStatus'],
  ) {
    return this.invoiceService.updateStatus(id, updateInvoiceStatusDto);
  }
}

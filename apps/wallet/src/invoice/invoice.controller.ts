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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import * as schema from './schema';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('status') status?: schema.InvoiceStatus,
  ) {
    const userIdAsNumber = userId ? parseInt(userId, 10) : undefined;
    return this.invoiceService.findAll(userIdAsNumber, status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.invoiceService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInvoiceStatusDto: UpdateInvoiceStatusDto,
  ) {
    return this.invoiceService.updateStatus(id, updateInvoiceStatusDto);
  }
}

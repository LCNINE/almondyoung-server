import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { CreateSalesOrderAmendmentDto } from '../dto/create-sales-order-amendment.dto';
import { SalesOrderAmendmentResponseDto } from '../dto/sales-order-amendment-response.dto';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Sales Order Amendments')
@Controller('sales-order-amendments')
export class SalesOrderAmendmentsController {
  constructor(private readonly service: SalesOrderAmendmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a SalesOrderAmendment for a post-acceptance delta' })
  @ApiResponse({ status: 201, description: 'SalesOrderAmendment created', type: SalesOrderAmendmentResponseDto })
  create(@Body() dto: CreateSalesOrderAmendmentDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.getUserId(user));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a SalesOrderAmendment' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  @ApiResponse({ status: 200, description: 'SalesOrderAmendment', type: SalesOrderAmendmentResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}

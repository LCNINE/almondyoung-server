import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { SuppliersService } from '../services/suppliers.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierFiltersDto,
  SupplierResponseDto,
  SupplierListResponseDto,
  SupplierFilterOptionsResponseDto,
} from '../dto';

@ApiTags('Suppliers')
@Controller('wms/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'Get suppliers list or filter options' })
  @ApiQuery({ 
    name: 'type', 
    required: false, 
    enum: ['filter-options'],
    description: 'Special query type: "filter-options" returns filter dropdown options' 
  })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name, phone, email, etc.' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category ID' })
  @ApiQuery({ name: 'purchaseManagerId', required: false, description: 'Filter by purchase manager ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns suppliers list or filter options depending on query type',
  })
  async getSuppliers(
    @Query('type') type?: string,
    @Query() filters?: SupplierFiltersDto,
  ): Promise<SupplierListResponseDto | SupplierFilterOptionsResponseDto> {
    if (type === 'filter-options') {
      return this.suppliersService.getFilterOptions();
    }

    return this.suppliersService.getSuppliers(filters || {});
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier by ID' })
  @ApiParam({ name: 'id', description: 'Supplier ID' })
  @ApiResponse({
    status: 200,
    description: 'Supplier found',
    type: SupplierResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Supplier not found',
  })
  async getSupplierById(@Param('id') id: string): Promise<SupplierResponseDto> {
    return this.suppliersService.getSupplierById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new supplier' })
  @ApiResponse({
    status: 201,
    description: 'Supplier created successfully',
    type: SupplierResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  async createSupplier(@Body() createDto: CreateSupplierDto): Promise<SupplierResponseDto> {
    return this.suppliersService.createSupplier(createDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update supplier' })
  @ApiParam({ name: 'id', description: 'Supplier ID' })
  @ApiResponse({
    status: 200,
    description: 'Supplier updated successfully',
    type: SupplierResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Supplier not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  async updateSupplier(
    @Param('id') id: string,
    @Body() updateDto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    return this.suppliersService.updateSupplier(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete supplier' })
  @ApiParam({ name: 'id', description: 'Supplier ID' })
  @ApiResponse({
    status: 204,
    description: 'Supplier deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Supplier not found',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSupplier(@Param('id') id: string): Promise<void> {
    return this.suppliersService.deleteSupplier(id);
  }
}


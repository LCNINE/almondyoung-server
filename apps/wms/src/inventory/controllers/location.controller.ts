import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  Logger
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody
} from '@nestjs/swagger';
import { LocationService } from '../services/location.service';
import {
  CreateColumnDto,
  CreateRackDto,
  CreateZoneLocationDto,
  AddCustomBinDto,
  LocationCreateResultDto
} from '../dto/location-create.dto';
import {
  UpdateLocationDto,
  UpdateColumnDto,
  UpdateRackDto
} from '../dto/location-update.dto';
import {
  LocationQueryDto,
  ColumnQueryDto,
  RackQueryDto
} from '../dto/location-query.dto';
import {
  LocationResponseDto,
  LocationColumnResponseDto,
  LocationRackResponseDto,
  StandardLocationResponseDto,
  ZoneLocationResponseDto,
  LocationListResponseDto
} from '../dto/location-response.dto';

@ApiTags('Location Management')
@Controller('locations')
export class LocationController {
  private readonly logger = new Logger(LocationController.name);

  constructor(private readonly locationService: LocationService) { }



  @Post('/warehouses/:warehouseId/columns')
  @ApiOperation({ summary: '새 열(Column) 생성' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiBody({ type: CreateColumnDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '열이 성공적으로 생성되었습니다.',
    type: LocationColumnResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (중복된 열 이름 등)'
  })
  async createColumn(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateColumnDto
  ) {
    this.logger.log(`Creating column ${dto.columnName} for warehouse ${warehouseId}`);
    return await this.locationService.createColumn(warehouseId, dto);
  }

  @Get('/warehouses/:warehouseId/columns')
  @ApiOperation({ summary: '창고의 모든 열 조회' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiQuery({ name: 'isActive', required: false, type: 'boolean', description: '활성 상태 필터' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '열 목록이 성공적으로 조회되었습니다.',
    type: [LocationColumnResponseDto]
  })
  async getColumns(
    @Param('warehouseId') warehouseId: string,
    @Query() query: ColumnQueryDto
  ) {
    return await this.locationService.getColumns(warehouseId, query.isActive);
  }

  @Put('/columns/:columnId')
  @ApiOperation({ summary: '열 정보 수정' })
  @ApiParam({ name: 'columnId', description: '열 ID' })
  @ApiBody({ type: UpdateColumnDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '열 정보가 성공적으로 수정되었습니다.',
    type: LocationColumnResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '열을 찾을 수 없습니다.'
  })
  async updateColumn(
    @Param('columnId') columnId: string,
    @Body() dto: UpdateColumnDto
  ) {
    return await this.locationService.updateColumn(columnId, dto);
  }



  @Post('/warehouses/:warehouseId/racks')
  @ApiOperation({
    summary: '새 랙 생성 (빈 자동생성 포함)',
    description: 'autoGenerateBins가 true이면 표준 빈들(A-01-01 형태)을 자동으로 생성합니다.'
  })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiBody({ type: CreateRackDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '랙과 빈들이 성공적으로 생성되었습니다.',
    type: LocationCreateResultDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (중복된 랙, 열이 없음 등)'
  })
  async createRack(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateRackDto
  ) {
    this.logger.log(`Creating rack ${dto.columnName}-${dto.rackNumber} for warehouse ${warehouseId}`);
    return await this.locationService.createRack(warehouseId, dto);
  }

  @Get('/warehouses/:warehouseId/racks')
  @ApiOperation({ summary: '창고의 모든 랙 조회' })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiQuery({ name: 'columnName', required: false, description: '열 이름 필터' })
  @ApiQuery({ name: 'isActive', required: false, type: 'boolean', description: '활성 상태 필터' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '랙 목록이 성공적으로 조회되었습니다.',
    type: [LocationRackResponseDto]
  })
  async getRacks(
    @Param('warehouseId') warehouseId: string,
    @Query() query: RackQueryDto
  ) {
    return await this.locationService.getRacks(
      warehouseId,
      query.columnName,
      query.isActive
    );
  }

  @Put('/racks/:rackId')
  @ApiOperation({ summary: '랙 정보 수정' })
  @ApiParam({ name: 'rackId', description: '랙 ID' })
  @ApiBody({ type: UpdateRackDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '랙 정보가 성공적으로 수정되었습니다.',
    type: LocationRackResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '랙을 찾을 수 없습니다.'
  })
  async updateRack(
    @Param('rackId') rackId: string,
    @Body() dto: UpdateRackDto
  ) {
    return await this.locationService.updateRack(rackId, dto);
  }



  @Post('/warehouses/:warehouseId/zones')
  @ApiOperation({
    summary: '새 구역 로케이션 생성',
    description: '한글 이름이 포함된 경우 자동으로 zone-N 형태의 바코드 코드를 생성합니다.'
  })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiBody({ type: CreateZoneLocationDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '구역 로케이션이 성공적으로 생성되었습니다.',
    type: ZoneLocationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (중복된 구역명 등)'
  })
  async createZoneLocation(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateZoneLocationDto
  ) {
    this.logger.log(`Creating zone location "${dto.code}" for warehouse ${warehouseId}`);
    return await this.locationService.createZoneLocation(warehouseId, dto);
  }



  @Get('/warehouses/:warehouseId')
  @ApiOperation({
    summary: '창고의 모든 로케이션 조회 (페이징, 필터링, 검색)',
    description: '표준 로케이션과 구역 로케이션을 모두 조회할 수 있습니다.'
  })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '로케이션 목록이 성공적으로 조회되었습니다.',
    type: LocationListResponseDto
  })
  async getLocations(
    @Param('warehouseId') warehouseId: string,
    @Query() query: LocationQueryDto
  ) {
    return await this.locationService.getLocations(warehouseId, query);
  }

  @Get('/:locationId')
  @ApiOperation({ summary: '특정 로케이션 상세 조회' })
  @ApiParam({ name: 'locationId', description: '로케이션 ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '로케이션 상세 정보가 성공적으로 조회되었습니다.',
    type: LocationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '로케이션을 찾을 수 없습니다.'
  })
  async getLocationById(@Param('locationId') locationId: string) {
    return await this.locationService.getLocationById(locationId);
  }



  @Put('/:locationId')
  @ApiOperation({ summary: '로케이션 정보 수정 (메타데이터만)' })
  @ApiParam({ name: 'locationId', description: '로케이션 ID' })
  @ApiBody({ type: UpdateLocationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '로케이션 정보가 성공적으로 수정되었습니다.',
    type: LocationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '로케이션을 찾을 수 없습니다.'
  })
  async updateLocation(
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto
  ) {
    return await this.locationService.updateLocation(locationId, dto);
  }



  @Post('/warehouses/:warehouseId/racks/custom-bins')
  @ApiOperation({
    summary: '기존 랙에 커스텀 빈 추가',
    description: '기존 랙에 "바닥", "상단" 등의 특수 빈을 추가합니다.'
  })
  @ApiParam({ name: 'warehouseId', description: '창고 ID' })
  @ApiBody({ type: AddCustomBinDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '커스텀 빈이 성공적으로 추가되었습니다.',
    type: StandardLocationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 (랙이 없음, 중복된 빈 등)'
  })
  async addCustomBin(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: AddCustomBinDto
  ) {
    this.logger.log(`Adding custom bin "${dto.customBinName}" to rack ${dto.columnName}-${dto.rackNumber}`);
    return await this.locationService.addCustomBin(warehouseId, dto);
  }
}
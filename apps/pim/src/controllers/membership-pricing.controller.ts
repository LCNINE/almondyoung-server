import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '@app/shared';
import { MembershipPricingService } from '../services/membership-pricing.service';
import {
  CreateMembershipMappingDto,
  UpdateMembershipMappingDto,
  MembershipMappingDto,
  CreateMembershipMappingSchema,
  UpdateMembershipMappingSchema,
} from '../schemas/membership-pricing.schema';

@ApiTags('Membership Pricing')
@Controller()
export class MembershipPricingController {
  constructor(
    private readonly membershipPricingService: MembershipPricingService,
  ) {}

  // ===== Master 레벨 정책 관리 =====

  @Post('masters/:masterId/membership-policies')
  @ApiOperation({ summary: '상품 마스터 멤버십 정책 생성' })
  @ApiParam({ name: 'masterId', description: '상품 마스터 ID' })
  @ApiBody({ type: CreateMembershipMappingDto })
  @ApiResponse({ status: 201, type: MembershipMappingDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 409, description: '이미 존재하는 정책' })
  async createMasterPolicy(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Body(new ZodValidationPipe(CreateMembershipMappingSchema))
    dto: CreateMembershipMappingDto,
  ): Promise<MembershipMappingDto> {
    try {
      const policy = await this.membershipPricingService.createMapping(
        'master',
        masterId,
        dto,
      );
      return policy as unknown as MembershipMappingDto;
    } catch (error) {
      if (error.message.includes('already exists')) {
        throw new Error('Mapping already exists for this tier');
      }
      throw new Error(`Failed to create mapping: ${error.message}`);
    }
  }

  @Get('masters/:masterId/membership-policies')
  @ApiOperation({ summary: '상품 마스터 멤버십 정책 목록 조회' })
  @ApiParam({ name: 'masterId', description: '상품 마스터 ID' })
  @ApiResponse({ status: 200, type: [MembershipMappingDto] })
  async getMasterPolicies(
    @Param('masterId', ParseUUIDPipe) masterId: string,
  ): Promise<MembershipMappingDto[]> {
    const mappings = await this.membershipPricingService.getMappings(
      'master',
      masterId,
    );
    return mappings as unknown as MembershipMappingDto[];
  }

  @Get('masters/:masterId/membership-price')
  @ApiOperation({ summary: '상품 마스터 멤버십 가격 계산' })
  @ApiParam({ name: 'masterId', description: '상품 마스터 ID' })
  @ApiQuery({
    name: 'membershipTierId',
    description: '멤버십 티어 ID',
    required: false,
  })
  @ApiQuery({ name: 'userId', description: '사용자 ID', required: false })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        originalPrice: { type: 'number' },
        membershipPrice: { type: 'number' },
        discount: { type: 'number' },
        discountAmount: { type: 'number' },
        policyApplied: { $ref: '#/components/schemas/MembershipMappingDto' },
      },
    },
  })
  async calculateMasterPrice(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Query('membershipTierId') membershipTierId?: string,
    @Query('userId') userId?: string,
  ) {
    const context = {
      masterId,
      membershipTierId,
      userId,
      requestTime: new Date(),
    };

    const calculation =
      await this.membershipPricingService.calculateMembershipPrice(context);
    return calculation;
  }

  @Get('masters/:masterId/visibility')
  @ApiOperation({ summary: '상품 마스터 가시성 확인' })
  @ApiParam({ name: 'masterId', description: '상품 마스터 ID' })
  @ApiQuery({
    name: 'membershipTierId',
    description: '멤버십 티어 ID',
    required: false,
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        visible: { type: 'boolean' },
        reason: { type: 'string' },
        hasVisibilityPolicy: { type: 'boolean' },
        requiredTierIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async checkMasterVisibility(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Query('membershipTierId') membershipTierId?: string,
  ) {
    const visibility =
      await this.membershipPricingService.checkProductVisibility(
        masterId,
        membershipTierId,
      );
    return visibility;
  }

  // ===== Variant 레벨 정책 관리 =====

  @Post('variants/:variantId/membership-policies')
  @ApiOperation({ summary: '상품 변형 멤버십 정책 생성' })
  @ApiParam({ name: 'variantId', description: '상품 변형 ID' })
  @ApiBody({ type: CreateMembershipMappingDto })
  @ApiResponse({ status: 201, type: MembershipMappingDto })
  async createVariantPolicy(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body(new ZodValidationPipe(CreateMembershipMappingSchema))
    dto: CreateMembershipMappingDto,
  ): Promise<MembershipMappingDto> {
    try {
      const policy = await this.membershipPricingService.createMapping(
        'variant',
        variantId,
        dto,
      );
      return policy as unknown as MembershipMappingDto;
    } catch (error) {
      if (error.message.includes('already exists')) {
        throw new Error('Mapping already exists for this tier');
      }
      throw new Error(`Failed to create mapping: ${error.message}`);
    }
  }

  @Get('variants/:variantId/membership-policies')
  @ApiOperation({ summary: '상품 변형 멤버십 정책 목록 조회' })
  @ApiParam({ name: 'variantId', description: '상품 변형 ID' })
  @ApiResponse({ status: 200, type: [MembershipMappingDto] })
  async getVariantPolicies(
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ): Promise<MembershipMappingDto[]> {
    const mappings = await this.membershipPricingService.getMappings(
      'variant',
      variantId,
    );
    return mappings as unknown as MembershipMappingDto[];
  }

  @Get('variants/:variantId/membership-price')
  @ApiOperation({ summary: '상품 변형 멤버십 가격 계산' })
  @ApiParam({ name: 'variantId', description: '상품 변형 ID' })
  @ApiQuery({
    name: 'membershipTierId',
    description: '멤버십 티어 ID',
    required: false,
  })
  @ApiQuery({ name: 'userId', description: '사용자 ID', required: false })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        originalPrice: { type: 'number' },
        membershipPrice: { type: 'number' },
        discount: { type: 'number' },
        discountAmount: { type: 'number' },
        policyApplied: { $ref: '#/components/schemas/MembershipMappingDto' },
      },
    },
  })
  async calculateVariantPrice(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Query('membershipTierId') membershipTierId?: string,
    @Query('userId') userId?: string,
  ) {
    // variantId로부터 masterId 조회 필요 (임시로 variantId 사용)
    const context = {
      masterId: variantId, // TODO: 실제로는 variant에서 masterId 조회
      variantId,
      membershipTierId,
      userId,
      requestTime: new Date(),
    };

    const calculation =
      await this.membershipPricingService.calculateMembershipPrice(context);
    return calculation;
  }

  // ===== 정책 개별 관리 =====

  @Put('membership-policies/:policyId')
  @ApiOperation({ summary: '멤버십 정책 수정' })
  @ApiParam({ name: 'policyId', description: '정책 ID' })
  @ApiBody({ type: UpdateMembershipMappingDto })
  @ApiResponse({ status: 200, type: MembershipMappingDto })
  async updatePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body(new ZodValidationPipe(UpdateMembershipMappingSchema))
    dto: UpdateMembershipMappingDto,
  ): Promise<MembershipMappingDto> {
    const policy = await this.membershipPricingService.updateMapping(
      policyId,
      dto,
    );
    return policy as unknown as MembershipMappingDto;
  }

  @Delete('membership-policies/:policyId')
  @ApiOperation({ summary: '멤버십 정책 삭제' })
  @ApiParam({ name: 'policyId', description: '정책 ID' })
  @ApiResponse({ status: 204 })
  async deletePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
  ): Promise<void> {
    await this.membershipPricingService.deleteMapping(policyId);
  }

  @Get('membership-policies')
  @ApiOperation({ summary: '멤버십 정책 목록 조회 (페이징)' })
  @ApiQuery({
    name: 'membershipTierId',
    description: '멤버십 티어 ID',
    required: false,
  })
  @ApiQuery({ name: 'page', description: '페이지 번호', required: false })
  @ApiQuery({ name: 'limit', description: '페이지 크기', required: false })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/MembershipMappingDto' },
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  async getPolicies(
    @Query('membershipTierId') membershipTierId?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const result = await this.membershipPricingService.getPaginatedMappings(
      undefined,
      undefined,
      membershipTierId,
      page,
      limit,
    );

    return {
      data: result.data as unknown as MembershipMappingDto[],
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
}

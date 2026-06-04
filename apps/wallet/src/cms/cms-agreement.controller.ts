import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { CmsAgreementService } from './cms-agreement.service';
import { CmsAgreementResponseDto, UploadCmsAgreementDto } from './dto';
import { CmsAgreementRecord } from '../types';
import {
  FastifyMultipartInterceptor,
  FastifyUploadedFile,
  UploadedFastifyFile,
} from '../common/fastify-multipart.interceptor';

@ApiTags('CMS Agreements')
@Controller('v1/cms-agreements')
export class CmsAgreementController {
  constructor(private readonly service: CmsAgreementService) {}

  @Post()
  @HttpCode(201)
  @WalletJwtAuth()
  @UseInterceptors(new FastifyMultipartInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a CMS agreement document' })
  async upload(
    @Body() dto: UploadCmsAgreementDto,
    @UploadedFastifyFile() file: FastifyUploadedFile,
  ): Promise<CmsAgreementResponseDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }

    try {
      const record = await this.service.uploadAgreement(dto.cmsMemberId, file.buffer, dto.fileType, dto.fileExtension);
      return this.toResponse(record);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.includes('failed')) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get(':key')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Get a CMS agreement document by agreement key' })
  async get(@Param('key') key: string): Promise<CmsAgreementResponseDto> {
    const record = await this.service.getAgreement(key);
    if (!record) {
      throw new NotFoundException('CMS agreement not found');
    }
    return this.toResponse(record);
  }

  private toResponse(r: CmsAgreementRecord): CmsAgreementResponseDto {
    return {
      id: r.id,
      cmsMemberId: r.cmsMemberId,
      agreementKey: r.agreementKey,
      fileType: r.fileType,
      fileExtension: r.fileExtension,
      status: r.status,
      createdAt: r.createdAt,
    };
  }
}

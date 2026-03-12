import { RequireScopes } from '@app/authorization';
import { JwtPayload } from '@app/roles';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DeleteFileDto } from './dto/delete-file.dto';
import { FileService } from './file.service';
import {
  FastifyFile,
  FastifyFileInterceptor,
} from './interceptors/fastify-file.interceptor';
import { ValidatedFile } from './interfaces/validated-file.interface';
import { FileValidatorPipe } from './pipes/file-validator.pipe';

@Controller('files')
@ApiTags('파일')
@ApiBearerAuth('access-token')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @FastifyFileInterceptor('file')
  @RequireScopes('user:modify')
  @ApiOperation({
    summary: '파일 업로드',
    description: '파일을 AWS S3에 업로드합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '업로드할 파일',
        },
      },
    },
  })
  async uploadFile(
    @FastifyFile(FileValidatorPipe) file: ValidatedFile,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fileService.uploadFile(file, user.id);
  }

  /**
   *  aws s3 폴더명과 파일명을 파라미터로 받아서 삭제
   */
  @Post('delete')
  @RequireScopes('user:delete')
  @ApiOperation({
    summary: '파일 삭제',
    description: 'AWS S3에서 사용자가 업로드한 파일을 삭제합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['folderName', 'fileName'],
      properties: {
        folderName: {
          type: 'string',
          description: 'S3 폴더명 (예: avatar, business-license)',
          example: 'avatar',
        },
        fileName: {
          type: 'string',
          description: '삭제할 파일명',
          example: '239ad90b-b1e5-4784-8e3d-b366c4e6bd9f.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '파일 삭제 성공',
  })
  @ApiResponse({
    status: 403,
    description: '본인의 파일만 삭제 가능합니다.',
  })
  @ApiResponse({
    status: 404,
    description: '파일을 찾을 수 없습니다.',
  })
  async deleteFile(
    @Body() deleteFileDto: DeleteFileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const key = `${deleteFileDto.folderName}/${user.id}/${deleteFileDto.fileName}`;
    await this.fileService.deleteFile(key);
  }
}

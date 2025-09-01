import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
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
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @FastifyFileInterceptor('file')
  @UsePipes(FileValidatorPipe)
  @RequireScopes(['user:write'])
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
  async uploadFile(@FastifyFile() file: ValidatedFile) {
    return this.fileService.uploadFile(file);
  }

  /**
   *  aws s3 폴더명과 파일명을 파라미터로 받아서 삭제
   */
  @Delete(':folderNameAndKey')
  @RequireScopes(['user:delete'])
  @ApiOperation({
    summary: '파일 삭제',
    description: 'AWS S3에서 지정된 파일을 삭제합니다.',
  })
  @ApiParam({
    name: 'folderNameAndKey',
    description: 'AWS S3의 폴더명과 파일명 (예: folder/filename.jpg)',
    type: 'string',
    required: true,
  })
  deleteFile(@Param('folderNameAndKey') folderNameAndKey: string) {
    return this.fileService.deleteFile(folderNameAndKey);
  }
}

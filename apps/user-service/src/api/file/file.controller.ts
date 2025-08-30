import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { FileService } from './file.service';
import {
  FastifyFile,
  FastifyFileInterceptor,
} from './interceptors/fastify-file.interceptor';
import { ValidatedFile } from './interfaces/validated-file.interface';
import { FileValidatorPipe } from './pipes/file-validator.pipe';

@Controller('files')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @FastifyFileInterceptor('file')
  @UsePipes(FileValidatorPipe)
  @RequireScopes(['user:write'])
  async uploadFile(@FastifyFile() file: ValidatedFile) {
    return this.fileService.uploadFile(file);
  }

  /**
   *  aws s3 폴더명과 파일명을 파라미터로 받아서 삭제
   */
  @Delete(':folderNameAndKey')
  @RequireScopes(['user:delete'])
  deleteFile(@Param('folderNameAndKey') folderNameAndKey: string) {
    return this.fileService.deleteFile(folderNameAndKey);
  }
}

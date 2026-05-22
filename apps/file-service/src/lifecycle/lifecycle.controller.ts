import { Controller, Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { FileAccess } from '../access/file-access';
import { DeleteResponseDto } from './dto/delete-response.dto';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

@ApiTags('Lifecycle')
@ApiBearerAuth()
@ApiSecurity('cookie')
@Controller('files')
export class LifecycleController {
  constructor(private readonly fileAccess: FileAccess) {}

  @Delete(':fileId')
  @ApiOperation({ summary: 'Soft delete a file' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File deleted successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async deleteFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @User() user: JwtPayload,
  ): Promise<DeleteResponseDto> {
    return this.fileAccess.delete(fileId, user);
  }
}

import { Controller, Patch, Delete, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { LifecycleService } from './lifecycle.service';
import { DeleteResponseDto } from './dto/activate-response.dto';

@ApiTags('Lifecycle')
@Controller('files')
export class LifecycleController {
  constructor(private readonly lifecycleService: LifecycleService) { }

  @Delete(':fileId')
  @ApiOperation({ summary: 'Soft delete a file' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File deleted successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async deleteFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<DeleteResponseDto> {
    const userId = 'temp-user-id';

    return this.lifecycleService.deleteFile(fileId, userId);
  }
}


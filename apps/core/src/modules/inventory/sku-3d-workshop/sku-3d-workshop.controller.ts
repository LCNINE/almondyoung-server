import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionCheckpoints, RequirePermission, User } from '@app/authorization';
import {
  ApproveWorkshopRevisionDto,
  ConfirmWorkshopDimensionsDto,
  PostWorkshopMessageDto,
  WorkshopEventsQueryDto,
  WorkshopFileParamDto,
} from './sku-3d-workshop.dto';
import { Sku3dWorkshopService } from './sku-3d-workshop.service';
import { workshopActorOf, type WorkshopUser } from './workshop-access';

@ApiTags('Inventory')
@Controller('inventory/sku-3d-workshops')
export class Sku3dWorkshopController {
  constructor(
    private readonly service: Sku3dWorkshopService,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @RequirePermission('inventory.model_workshop.write')
  @Post('skus/:skuId')
  @ApiOperation({ summary: '내 3D 작업실 열기 — 처음이면 만들고, 있으면 그대로 돌려준다' })
  open(@Param('skuId', ParseUUIDPipe) skuId: string, @User() user: WorkshopUser) {
    return this.service.open(skuId, workshopActorOf(user, this.checkpoints));
  }

  @RequirePermission('inventory.model_workshop.read')
  @Get(':id')
  @ApiOperation({ summary: '작업실 상세 — 사진·치수·진행 작업·버전·작업 PC 상태' })
  detail(@Param('id', ParseUUIDPipe) id: string, @User() user: WorkshopUser) {
    return this.service.detail(id, workshopActorOf(user, this.checkpoints));
  }

  @RequirePermission('inventory.model_workshop.read')
  @Get(':id/events')
  @ApiOperation({ summary: '받은 마지막 seq 다음의 대화·진행 이벤트' })
  events(@Param('id', ParseUUIDPipe) id: string, @Query() query: WorkshopEventsQueryDto, @User() user: WorkshopUser) {
    return this.service.events(id, workshopActorOf(user, this.checkpoints), query.afterSeq ?? 0);
  }

  @RequirePermission('inventory.model_workshop.read')
  @Get(':id/revisions/:revisionId/files/:kind')
  @ApiOperation({ summary: '승인 전 검토 파일(GLB·렌더) — 작업실 권한을 본 뒤 비공개 저장소에서 꺼낸다' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Param() { kind }: WorkshopFileParamDto,
    @User() user: WorkshopUser,
  ): Promise<StreamableFile> {
    const file = await this.service.revisionFile(id, revisionId, kind, workshopActorOf(user, this.checkpoints));

    return new StreamableFile(file.bytes, { type: file.contentType, disposition: 'inline' });
  }

  @RequirePermission('inventory.model_workshop.write')
  @Put(':id/dimensions')
  @ApiOperation({ summary: '치수 기준 확인 — 첫 확인이면 제작을 요청한다' })
  confirmDimensions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmWorkshopDimensionsDto,
    @User() user: WorkshopUser,
  ) {
    return this.service.confirmDimensions(id, workshopActorOf(user, this.checkpoints), body.basis);
  }

  @RequirePermission('inventory.model_workshop.write')
  @Post(':id/messages')
  @ApiOperation({ summary: '수정 요청 — 같은 Codex 세션으로 새 버전을 만든다' })
  postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PostWorkshopMessageDto,
    @User() user: WorkshopUser,
  ) {
    return this.service.postMessage(id, workshopActorOf(user, this.checkpoints), body.body);
  }

  @RequirePermission('inventory.model_workshop.write')
  @Post(':id/revisions/:revisionId/approve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '보고 있는 버전(revisionId + GLB 해시)을 승인해 공개 — 기존 업로드·draft 등록·publish 순서, 재시도해도 한 번',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() body: ApproveWorkshopRevisionDto,
    @User() user: WorkshopUser,
  ) {
    return this.service.approve(id, revisionId, body.glbSha256, workshopActorOf(user, this.checkpoints));
  }
}

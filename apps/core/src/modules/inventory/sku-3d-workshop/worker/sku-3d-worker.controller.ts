import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, ServiceKeyRoute } from '@app/authorization';
import {
  AddWorkerEventsDto,
  CompleteWorkerJobDto,
  FailWorkerJobDto,
  LeaseDto,
  RecordSessionDto,
} from './sku-3d-worker.dto';
import { Sku3dWorkerKeyInterceptor, type WorkerRequest } from './sku-3d-worker-key.interceptor';
import { AuthenticatedWorker, Sku3dWorkerManager } from './sku-3d-worker.manager';
import { readWorkerUpload } from './worker-upload.multipart';

const Worker = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedWorker => {
  const worker = context.switchToHttp().getRequest<WorkerRequest>().sku3dWorker;

  if (!worker) {
    throw new UnauthorizedException('워커 키가 필요해요');
  }

  return worker;
});

// 홈 PC 워커 전용 문 — 사람 토큰이 아니라 sku_3d_workers 의 키로 들어온다. 테넌트는 x-tenant-id 헤더
@ApiTags('Inventory - 3D worker')
@ApiBearerAuth()
@Public()
@ServiceKeyRoute()
@UseInterceptors(Sku3dWorkerKeyInterceptor)
@Controller('inventory/sku-3d-worker')
export class Sku3dWorkerController {
  constructor(private readonly manager: Sku3dWorkerManager) {}

  @Post('claim')
  @HttpCode(200)
  @ApiOperation({ summary: '대기 작업 하나를 lease 와 함께 가져간다(없으면 job: null)' })
  async claim(@Worker() worker: AuthenticatedWorker) {
    return { job: await this.manager.claim(worker) };
  }

  @Post('jobs/:id/heartbeat')
  @HttpCode(204)
  @ApiOperation({ summary: 'lease 연장 — 409 면 작업을 잃은 것이다' })
  async heartbeat(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaseDto,
  ) {
    await this.manager.heartbeat(worker, id, body.leaseToken);
  }

  @Post('jobs/:id/session')
  @HttpCode(204)
  @ApiOperation({ summary: 'Codex 세션 id 를 작업실에 한 번만 적는다' })
  async session(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordSessionDto,
  ) {
    await this.manager.recordSession(worker, id, body.leaseToken, body.sessionId);
  }

  @Post('jobs/:id/events')
  @HttpCode(204)
  @ApiOperation({ summary: '진행 상황을 작업실에 남긴다' })
  async events(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddWorkerEventsDto,
  ) {
    await this.manager.addEvents(worker, id, body.leaseToken, body.items);
  }

  @Get('jobs/:id/inputs')
  @ApiOperation({ summary: '작업 입력 — 상품·치수 기준·사진 id·요청문·세션 id' })
  inputs(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('leaseToken', ParseUUIDPipe) leaseToken: string,
  ) {
    return this.manager.inputs(worker, id, leaseToken);
  }

  @Get('jobs/:id/files/:fileId')
  @ApiOperation({ summary: '그 작업의 원본 사진·기준 버전 파일 바이트' })
  async download(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('leaseToken', ParseUUIDPipe) leaseToken: string,
  ): Promise<StreamableFile> {
    const file = await this.manager.file(worker, id, leaseToken, fileId);

    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  @Post('jobs/:id/files')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '산출물 업로드(leaseToken 칸 + file) — 작업실 주인 이름으로 비공개 저장소에 올린다' })
  async upload(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { leaseToken, ...file } = await readWorkerUpload(request);

    return this.manager.upload(worker, id, leaseToken, file);
  }

  @Post('jobs/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '결과 제출 — lease 를 쥔 워커만. 새 버전을 만들고 검토 요약을 채팅에 올린다' })
  complete(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteWorkerJobDto,
  ) {
    const { leaseToken, ...input } = body;

    return this.manager.complete(worker, id, leaseToken, input);
  }

  @Post('jobs/:id/fail')
  @HttpCode(204)
  @ApiOperation({ summary: '실패 보고 — 재시도 가능하면 대기열로 되돌린다' })
  async fail(
    @Worker() worker: AuthenticatedWorker,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FailWorkerJobDto,
  ) {
    await this.manager.fail(worker, id, body.leaseToken, body.error, body.retryable);
  }
}

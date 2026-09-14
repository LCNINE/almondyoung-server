import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ConflictError } from '@app/shared';

export type WarehouseActor = { userId?: string; id?: string; sub?: string } | undefined;

/** Additive rollout: omitted/1 is the existing contract; 2 requires a durable key. */
export class WarehouseOperationVersionDto {
  @ApiPropertyOptional({ enum: [1, 2] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  contractVersion?: number;
}

export class WarehouseOperationDto extends WarehouseOperationVersionDto {
  @ApiPropertyOptional({ maxLength: 90 })
  @ValidateIf((object, value) => object.contractVersion === 2 || value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(90)
  idempotencyKey?: string;
}

export class WarehouseOperationConflict extends ConflictError {
  constructor(private readonly code: 'OPERATION_PAYLOAD_MISMATCH' | 'OPERATION_IN_PROGRESS') {
    super(code === 'OPERATION_PAYLOAD_MISMATCH' ? '작업 내용이 달라 확인이 필요해요.' : '처리 여부를 확인하고 있어요.');
  }
  getErrorCode(): string {
    return this.code;
  }
}

export function authenticatedWarehouseActor(user: WarehouseActor): string {
  const actorId = user?.userId ?? user?.id ?? user?.sub;
  if (!actorId?.trim()) throw new UnauthorizedException('Authenticated actor is required');
  return actorId;
}

export function warehouseOperationContext(
  dto: WarehouseOperationDto,
  user: WarehouseActor,
  headerKey?: string,
): string | undefined {
  if (dto.contractVersion === undefined || dto.contractVersion === 1) {
    if (process.env.WAREHOUSE_REQUIRE_OPERATION_V2 === 'true') {
      authenticatedWarehouseActor(user);
      throw new HttpException({ code: 'CLIENT_UPDATE_REQUIRED', message: '앱을 업데이트해 주세요.' }, 426);
    }
    return undefined;
  }
  const actorId = authenticatedWarehouseActor(user);
  if (dto.contractVersion !== 2) {
    throw new HttpException({ code: 'CLIENT_UPDATE_REQUIRED', message: '앱을 업데이트해 주세요.' }, 426);
  }
  if (typeof dto.idempotencyKey !== 'string' || !dto.idempotencyKey.trim() || dto.idempotencyKey.length > 90) {
    throw new BadRequestException('작업 정보가 올바르지 않아요.');
  }
  if (headerKey !== undefined && headerKey !== dto.idempotencyKey) {
    throw new WarehouseOperationConflict('OPERATION_PAYLOAD_MISMATCH');
  }
  return actorId;
}

/** V1 bytes are never normalized. Only v2 callers use this canonical JSON body. */
export function canonicalWarehouseRequest(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(canonicalWarehouseRequest);
  if (body !== null && typeof body === 'object') {
    return Object.fromEntries(
      Object.entries(body)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonicalWarehouseRequest(value)]),
    );
  }
  return body;
}

export function warehouseRequest(dto: WarehouseOperationDto, actorId?: string): unknown {
  if (dto.contractVersion !== 2) return dto;
  if (!actorId) throw new UnauthorizedException('Authenticated actor is required');
  const { idempotencyKey: _key, contractVersion: _version, ...payload } = dto;
  return canonicalWarehouseRequest({ ...payload, actorId });
}

export function warehouseEndpoint(endpoint: string, dto: WarehouseOperationDto): string {
  return dto.contractVersion === 2 ? `${endpoint}.v2` : endpoint;
}

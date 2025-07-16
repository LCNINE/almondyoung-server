import { createZodDto, } from 'nestjs-zod';
import { 
  SettlementBatchSchema, 
  CreateSettlementBatchSchema,
  UpdateSettlementBatchSchema
} from '../schema';

// 정산 배치 생성 DTO
export class CreateSettlementBatchDto extends createZodDto(CreateSettlementBatchSchema) {}

// 정산 배치 응답 DTO
export class SettlementBatchResponseDto extends createZodDto(SettlementBatchSchema) {}

// 정산 배치 업데이트 DTO
export class UpdateSettlementBatchDto extends createZodDto(UpdateSettlementBatchSchema) {}
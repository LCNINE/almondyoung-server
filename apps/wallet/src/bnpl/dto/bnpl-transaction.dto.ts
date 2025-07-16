import { createZodDto, ZodDto } from 'nestjs-zod';
import {
  BnplTransactionSchema,
  CreateBnplTransactionSchema
} from '../schema';

// BNPL 거래 생성 DTO
export class CreateBnplTransactionDto extends createZodDto(CreateBnplTransactionSchema) { }

// BNPL 거래 응답 DTO
export class BnplTransactionResponseDto extends createZodDto(BnplTransactionSchema) { }
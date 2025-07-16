import { createZodDto, ZodDto } from 'nestjs-zod';

import { BnplAccountSchema, CreateBnplAccountSchema } from '../schema';

// BNPL 계정 생성 DTO
export class CreateBnplAccountDto extends createZodDto(CreateBnplAccountSchema) {}

// BNPL 계정 응답 DTO
export class BnplAccountResponseDto extends createZodDto(BnplAccountSchema) {}
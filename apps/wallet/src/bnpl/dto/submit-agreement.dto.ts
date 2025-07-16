import { createZodDto} from 'nestjs-zod';
import { z } from 'zod';

/**
 * BNPL 동의자료 제출 스키마
 */
export const SubmitAgreementSchema = z.object({
  memberId: z.string(),
  custId: z.string().optional().default('default-cust'),
  agreementText: z.string().min(10),
});

/**
 * BNPL 동의자료 제출 DTO
 */

export class SubmitAgreementDto extends createZodDto(SubmitAgreementSchema) {}
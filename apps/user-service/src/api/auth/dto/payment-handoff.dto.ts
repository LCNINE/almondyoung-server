import { OmitType } from '@nestjs/swagger';
import { IssueCodeRequestDto } from '../../oauth/dto/issue-code.dto';

export class PaymentHandoffCodeRequestDto extends OmitType(IssueCodeRequestDto, ['clientId', 'userId'] as const) {}

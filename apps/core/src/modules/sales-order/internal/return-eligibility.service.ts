import { Injectable } from '@nestjs/common';
import { ReturnEligibilityReader } from './return-eligibility.reader';
import type { ReturnEligibilityRequestDto } from './return-eligibility.dto';
import type { ReturnEligibilityResponse } from './return-eligibility';

@Injectable()
export class ReturnEligibilityService {
  constructor(private readonly reader: ReturnEligibilityReader) {}

  read(dto: ReturnEligibilityRequestDto): Promise<ReturnEligibilityResponse> {
    return this.reader.read(dto.externalOrderId);
  }
}

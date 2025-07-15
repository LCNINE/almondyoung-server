import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { HmsAPI } from 'hms-api-wrapper';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../payment-method/schema';
import { CreateCardMethodDto } from '../dto/create-card-method.dto';

@Injectable()
export class CardMethodStrategy {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    @Inject(HmsAPI) private readonly hmsApi: HmsAPI,
  ) {}

  supports(methodType: string): boolean {
    return methodType === 'CARD';
  }

  validate(payload: unknown): void {
    // 카드 결제수단 유효성 검사 (구현 예정)
  }

  // 카드 등록/삭제/조회 등 기존 card-payment.strategy.ts의 주요 메서드 이관 예정
}

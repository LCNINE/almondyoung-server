import { PartialType } from '@nestjs/mapped-types';
import { CreateDeliveryProfileDto } from './create-delivery-profile.dto';

/** 부분 수정. 중첩 객체는 보낼 때 통째로 보낸다 — 보낸 객체는 생성과 같은 규칙으로 전부 검증된다. */
export class UpdateDeliveryProfileDto extends PartialType(CreateDeliveryProfileDto) {}

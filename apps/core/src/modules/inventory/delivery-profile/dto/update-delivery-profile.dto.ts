import { ApiProperty } from '@nestjs/swagger';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateDeliveryProfileDto } from './create-delivery-profile.dto';

/**
 * avgDeliveryDays 를 뺀 나머지 필드만 담은 중간 클래스. UpdateDeliveryProfileDto 가 avgDeliveryDays
 * 를 `number | null`(PartialType 이 만드는 `number | undefined` 보다 넓게)로 다시 선언해야 하는데,
 * TypeScript 는 서브클래스가 부모 필드를 더 넓은 타입으로 덮어쓰는 걸 금지한다(TS2416) — 애초에
 * 부모(PartialType(CreateDeliveryProfileDto, …)) 가 이 필드를 갖지 않게 잘라낸다.
 */
class CreateDeliveryProfileDtoWithoutAvgDeliveryDays extends OmitType(CreateDeliveryProfileDto, [
  'avgDeliveryDays',
] as const) {}

/**
 * 부분 수정. 중첩 객체는 보낼 때 통째로 보낸다 — 보낸 객체는 생성과 같은 규칙으로 전부 검증된다.
 *
 * `PartialType` 기본값(`skipNullProperties` 생략)은 각 필드에 `@IsOptional()` 을 붙이는데,
 * class-validator 의 `@IsOptional()` 구현은 `value !== null && value !== undefined` 로 "안 보냄"을
 * 판정한다 — 즉 `null` 도 "안 보냄"과 똑같이 전 검증을 건너뛴다. 그래서 `{ name: null }` 같은 PATCH 가
 * 검증을 통과해 `toColumns`/`trim()` 에서 TypeError → 500 이 났고(name/sender/originAddress/
 * returnAddress/carrierAccountRef), `{ sourceType: null }` 은 NOT NULL 위반 500, `{ supportedFulfillmentModes:
 * null }` 은 저장은 되지만 계획 확정·배치 편입의 완전성 검사를 다시 깨뜨렸다.
 *
 * `{ skipNullProperties: false }` 는 PartialType 이 `@IsOptional()` 대신 `@ValidateIf(v => v !== undefined)`
 * 를 붙이게 한다 — `undefined`(필드를 안 보냄)만 스킵하고 `null` 은 그 필드의 검증기를 그대로 통과시킨다
 * (문자열/배열 필드는 타입이 안 맞아 그대로 실패한다). avgDeliveryDays 만 예외 — PATCH 로 값을 지우는
 * 유일한 방법이 `null` 이라, 이 필드만 아래에서 `@IsOptional()` 로 null 을 "지우기"로 허용한다.
 */
export class UpdateDeliveryProfileDto extends PartialType(CreateDeliveryProfileDtoWithoutAvgDeliveryDays, {
  skipNullProperties: false,
}) {
  @ApiProperty({ description: '평균 배송일 (null 이면 값 지우기)', required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  avgDeliveryDays?: number | null;
}

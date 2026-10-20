import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { parsePiiPath, type PiiKind, type PiiPath } from '@app/shared/pii';
import type { Permission } from '../permissions/permission-catalog';

export const PII_RESPONSE_KEY = 'pii_response';
export const PII_EXPORT_KEY = 'pii_export';
export const PII_WRITE_KEY = 'pii_write';

/** 접속기록에 남기는 «정보주체(대상)» 의 종류. 원문 값이 아니라 식별자만 남긴다. */
export type PiiSubjectType =
  | 'user'
  | 'sales_order'
  | 'sales_order_amendment'
  | 'shipment'
  | 'fulfillment_order'
  | 'fulfillment_operation'
  | 'return_request'
  | 'exchange_request'
  | 'cs_case'
  | 'payment_intent'
  | 'refund_request'
  | 'recurring_invoice'
  | 'membership_contract'
  | 'business_license'
  | 'notification'
  | 'sms_conversation'
  | 'review'
  | 'qna_question'
  | 'shop_listing'
  | 'print_order'
  | 'channel_order'
  | 'event_record'
  | 'medusa_customer'
  | 'medusa_order';

/** 대상 식별자를 응답 경로(`path`) 또는 경로 파라미터(`param`, 상세 응답에 id 가 없을 때) 중 하나에서 읽는다. */
export interface PiiSubjectPath {
  readonly path?: PiiPath;
  readonly param?: string;
  readonly type: PiiSubjectType;
  /** 값 자체가 개인정보일 때(비회원 전화번호 등) — 기록에는 값 대신 해시를 남긴다. */
  readonly hash?: boolean;
}

/**
 * 이 라우트 응답에서 개인정보가 실리는 경로와 대상 식별자 경로. 경로는 응답 감싸기(`{success,data}`) 전 본문 기준.
 * 권한이 없는 직원에게는 가린 값이, 원문을 받는 직원에게는 원문과 함께 접속기록 1행이 남는다(ADR-0045).
 */
export interface PiiResponseSpec {
  readonly fields: Readonly<Record<PiiPath, PiiKind>>;
  readonly subjects: readonly PiiSubjectPath[];
  /** 단건 상세만 — 기본 가림 모드에서 [보기] 로 원문을 다시 받을 수 있다. */
  readonly reveal?: boolean;
  /** 원문을 여는 권한. 기본 `customer.pii.read`. */
  readonly rawWith?: readonly Permission[];
  /** 필드별 예외(출고 화면의 수령인 정보처럼). 키는 `fields` 에 선언된 경로여야 한다. */
  readonly rawWithByField?: Readonly<Record<PiiPath, readonly Permission[]>>;
}

export const DEFAULT_PII_RAW_WITH: readonly Permission[] = ['customer.pii.read'];

function assertSpec(spec: PiiResponseSpec): void {
  const paths = Object.keys(spec.fields);
  if (paths.length === 0) throw new Error('PiiResponse needs at least one field');
  if (spec.subjects.length === 0) throw new Error('PiiResponse needs at least one subject path');
  for (const path of paths) parsePiiPath(path);
  for (const subject of spec.subjects) {
    if ((subject.path === undefined) === (subject.param === undefined)) {
      throw new Error('PiiResponse subject needs exactly one of path or param');
    }
    if (subject.path !== undefined) parsePiiPath(subject.path);
  }
  for (const path of Object.keys(spec.rawWithByField ?? {})) {
    if (!(path in spec.fields)) throw new Error(`PiiResponse rawWithByField path is not a declared field: ${path}`);
  }
}

export function PiiResponse(spec: PiiResponseSpec): MethodDecorator {
  assertSpec(spec);
  return applyDecorators(SetMetadata(PII_RESPONSE_KEY, spec));
}

/** 개인정보가 든 내보내기 — 원문이 나갈 때 사유 헤더(`X-Pii-Export-Reason`)가 필요하다. */
export function PiiExport(): MethodDecorator {
  return applyDecorators(SetMetadata(PII_EXPORT_KEY, true));
}

/**
 * 요청 본문으로 개인정보 원문을 받는 쓰기. 본문의 그 필드에 값이 있으면 그 원문을 볼 수 있는 권한(`rawWith`, 기본
 * `customer.pii.read`)이 있어야 한다 — 가린 값을 본 사람이 그 값을 그대로 다시 저장하지 않게(필드 수준: 고치려면 볼 수
 * 있어야 한다). 경로는 본문 기준 점 경로(`address`·`customer.phone`) — 배열·와일드카드 없이.
 */
export interface PiiWriteSpec {
  readonly fields: readonly PiiPath[];
  readonly rawWith?: readonly Permission[];
}

export function PiiWrite(spec: PiiWriteSpec): MethodDecorator {
  if (spec.fields.length === 0) throw new Error('@PiiWrite needs at least one field');
  for (const path of spec.fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) {
      throw new Error(`@PiiWrite takes plain dotted body paths: ${path}`);
    }
  }
  return applyDecorators(SetMetadata(PII_WRITE_KEY, spec));
}

type Handler = Parameters<Reflector['get']>[1];

export function piiWriteOf(reflector: Reflector, handler: Handler): PiiWriteSpec | undefined {
  return reflector.get<PiiWriteSpec | undefined>(PII_WRITE_KEY, handler);
}

export function piiResponseOf(reflector: Reflector, handler: Handler): PiiResponseSpec | undefined {
  return reflector.get<PiiResponseSpec | undefined>(PII_RESPONSE_KEY, handler);
}

export function isPiiExport(reflector: Reflector, handler: Handler): boolean {
  return reflector.get<boolean | undefined>(PII_EXPORT_KEY, handler) === true;
}

/** 출고 화면의 받는 분·주문자 정보 — 개인정보 권한 또는 수령인 권한으로 원문을 연다(물류 현장 업무). */
export const OPEN_WITH_RECIPIENT: readonly Permission[] = ['customer.pii.read', 'fulfillment.recipient.read'];

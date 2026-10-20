import { maskPiiValue, type MaskableKind, type PiiKind } from '@pii-masking';

export type MedusaSubjectType = 'medusa_customer' | 'medusa_order';

export interface MedusaPiiRule {
  /** 접속기록의 «라우트» — 실제 id 대신 패턴을 남긴다. */
  readonly pattern: string;
  readonly subjectType: MedusaSubjectType;
  /** 단건 상세 — 기본 가림 모드에서 [보기] 로 원문을 다시 받을 수 있다. */
  readonly revealable: boolean;
}

interface RuleEntry extends MedusaPiiRule {
  readonly method: string;
}

/**
 * 개인정보가 나오는 Medusa 경로. 응답 «경로»가 아니라 «키 이름»으로 가린다 — Medusa 는 `fields` 로 요청자가
 * 필드를 고를 수 있어서 경로를 미리 적어 두면 확장한 필드가 빠진다(ADR-0048).
 */
const RULES: readonly RuleEntry[] = [
  { method: 'GET', pattern: 'admin/customers', subjectType: 'medusa_customer', revealable: false },
  { method: 'GET', pattern: 'admin/customers/:id', subjectType: 'medusa_customer', revealable: true },
  { method: 'GET', pattern: 'admin/customers/by-almond-user/:id', subjectType: 'medusa_customer', revealable: true },
  { method: 'POST', pattern: 'admin/customers/:id/addresses', subjectType: 'medusa_customer', revealable: false },
  { method: 'POST', pattern: 'admin/customers/:id/addresses/:addressId', subjectType: 'medusa_customer', revealable: false },
  { method: 'DELETE', pattern: 'admin/customers/:id/addresses/:addressId', subjectType: 'medusa_customer', revealable: false },
  { method: 'GET', pattern: 'admin/customer-groups', subjectType: 'medusa_customer', revealable: false },
  { method: 'GET', pattern: 'admin/orders', subjectType: 'medusa_order', revealable: false },
  { method: 'GET', pattern: 'admin/orders/:id', subjectType: 'medusa_order', revealable: true },
  { method: 'GET', pattern: 'admin/promotions/:id/customers', subjectType: 'medusa_customer', revealable: false },
  { method: 'POST', pattern: 'admin/promotions/:id/customers', subjectType: 'medusa_customer', revealable: false },
  { method: 'DELETE', pattern: 'admin/promotions/:id/customers', subjectType: 'medusa_customer', revealable: false },
];

/** 개인정보 키와 종류. `metadata` 는 옛 공동현관 비밀번호 등 모양이 정해지지 않은 값이 있어 통째로 가린다. */
const PII_KEYS: Readonly<Record<string, MaskableKind | 'redact'>> = {
  email: 'email',
  phone: 'phone',
  first_name: 'name',
  last_name: 'name',
  company_name: 'name',
  address_1: 'address',
  address_2: 'text',
  postal_code: 'postal',
  metadata: 'redact',
};

const PII_READ = 'customer.pii.read';
const SUBJECT_CAP = 1000;

function matches(pattern: string, path: readonly string[]): boolean {
  const parts = pattern.split('/');
  return parts.length === path.length && parts.every((part, i) => part.startsWith(':') || part === path[i]);
}

export function medusaPiiRuleFor(method: string, path: readonly string[]): MedusaPiiRule | null {
  const fixed = (r: RuleEntry) => r.pattern.split('/').filter((p) => !p.startsWith(':')).length;
  const hit = RULES.filter((r) => r.method === method.toUpperCase() && matches(r.pattern, path)).sort(
    (a, b) => fixed(b) - fixed(a),
  )[0];
  return hit ? { pattern: hit.pattern, subjectType: hit.subjectType, revealable: hit.revealable } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

interface Walk {
  count: number;
  kinds: Set<PiiKind>;
}

function walkMask(node: unknown, state: Walk, mask: boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => walkMask(item, state, mask));
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const kind = PII_KEYS[key];
    if (kind && isPresent(value)) {
      state.count += 1;
      if (kind !== 'redact' && typeof value === 'string') {
        state.kinds.add(kind);
        out[key] = mask ? maskPiiValue(kind, value) : value;
      } else {
        state.kinds.add('redact');
        out[key] = mask ? null : value;
      }
      continue;
    }
    out[key] = walkMask(value, state, mask);
  }
  return out;
}

export function maskMedusaBody(body: unknown): { body: unknown; maskedKinds: PiiKind[]; maskedValueCount: number } {
  const state: Walk = { count: 0, kinds: new Set() };
  const masked = walkMask(body, state, true);
  return { body: masked, maskedKinds: [...state.kinds], maskedValueCount: state.count };
}

function piiOf(body: unknown): { count: number; kinds: PiiKind[] } {
  const state: Walk = { count: 0, kinds: new Set() };
  walkMask(body, state, false);
  return { count: state.count, kinds: [...state.kinds] };
}

/** 응답 맨 위의 고객·주문(단건 또는 목록) id. */
function subjectIds(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const ids = new Set<string>();
  for (const value of Object.values(body)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (isRecord(item) && typeof item.id === 'string') ids.add(item.id);
    }
  }
  return [...ids];
}

/** user-service `POST /iam/pii-access-logs` 본문 — 행위자는 토큰이 정한다. 원문 값은 담지 않는다. */
export interface MedusaAccessRecord {
  readonly eventId: string;
  readonly sourceService: 'admin-web';
  readonly method: string;
  readonly route: string;
  readonly action: 'view' | 'reveal';
  readonly subjects: readonly { readonly type: MedusaSubjectType; readonly id: string }[];
  readonly subjectCount: number;
  readonly kinds: readonly PiiKind[];
  readonly queryKeys: readonly string[];
  readonly reason: null;
  readonly occurredAt: string;
  readonly claimedIp: string | null;
  readonly forwardedFor: string | null;
  readonly peerIp: null;
}

export interface MedusaPiiInput {
  readonly body: unknown;
  readonly rule: MedusaPiiRule;
  readonly method: string;
  readonly queryKeys: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly revealRequired: boolean;
  readonly revealRequested: boolean;
  readonly client: Readonly<Record<string, string>>;
  readonly now: Date;
  readonly record: (entry: MedusaAccessRecord) => Promise<void>;
}

/**
 * 권한이 있으면 원문을 그대로 넘기면서 접속기록 1행을 남긴다 — 기록에 실패하면 가린다.
 * 권한이 없거나(쿠폰 화면처럼 다른 권한으로 고객 목록에 들어온 경우 포함) 기본 가림 모드면 가린 사본을 넘긴다.
 */
export async function applyMedusaPii(input: MedusaPiiInput): Promise<{ body: unknown; headers: Record<string, string> }> {
  const holder = input.permissions.has(PII_READ);
  const revealing = input.revealRequired && input.rule.revealable && input.revealRequested;
  let reason: string | null = null;
  if (!holder) reason = 'no-permission';
  else if (input.revealRequired && !revealing) reason = 'reveal-required';

  if (reason === null) {
    const found = piiOf(input.body);
    if (found.count === 0) return { body: input.body, headers: { 'x-pii-masked': 'none' } };
    const ids = subjectIds(input.body);
    try {
      await input.record({
        eventId: crypto.randomUUID(),
        sourceService: 'admin-web',
        method: input.method,
        route: input.rule.pattern,
        action: revealing ? 'reveal' : 'view',
        subjects: ids.slice(0, SUBJECT_CAP).map((id) => ({ type: input.rule.subjectType, id })),
        subjectCount: ids.length,
        kinds: found.kinds,
        queryKeys: input.queryKeys,
        reason: null,
        occurredAt: input.now.toISOString(),
        claimedIp: input.client['x-staff-client-ip'] ?? null,
        forwardedFor: input.client['x-staff-forwarded-for'] ?? null,
        peerIp: null,
      });
      return { body: input.body, headers: { 'x-pii-masked': 'none' } };
    } catch {
      reason = 'record-failed';
    }
  }

  const masked = maskMedusaBody(input.body);
  if (masked.maskedValueCount === 0) return { body: input.body, headers: { 'x-pii-masked': 'none' } };
  const headers: Record<string, string> = {
    'x-pii-masked': [...masked.maskedKinds].sort().join(','),
    'x-pii-mask-reason': reason,
  };
  if (reason === 'reveal-required' && input.rule.revealable) headers['x-pii-revealable'] = '1';
  return { body: masked.body, headers };
}

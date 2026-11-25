import { classifyOperationReason, SHIPMENT_OPERATION_REASONS } from '../shipment/shipment-operation-reasons';

export type SplitLink = { operationId: string; shipmentId: string };

export type SplitOperation = {
  id: string;
  reason: string;
  reasonCode: string | null;
  // DB 완료 시각(마이크로초). 같은 밀리초에 끝난 나누기도 순서가 갈린다
  completedAtMicros: number | null;
};

// 이 사유로 나눈 두 쪽은 다시 합치자고 제안하지 않는다
export const KEPT_APART_SPLIT_REASONS: ReadonlySet<string> = new Set(['does_not_fit']);

export type KeptApartSplits = ReadonlyMap<string, { family: string; side: string }>;

// 같은 나누기 작업에 든 상자를 한 묶음으로 잇는다. 나눈 상자를 다시 나눠도 한 묶음이다.
// 묶음 키는 묶음 안 가장 작은 상자 id 라 읽은 순서와 상관없이 같다.
export function splitFamilyRoot(links: readonly SplitLink[]): (shipmentId: string) => string {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;

    if (up === id) return id;

    const top = root(up);

    parent.set(id, top);

    return top;
  };
  const firstBoxByOperation = new Map<string, string>();

  for (const link of links) {
    const first = firstBoxByOperation.get(link.operationId);

    if (first === undefined) {
      firstBoxByOperation.set(link.operationId, link.shipmentId);
    } else {
      const [low, high] = [root(link.shipmentId), root(first)].sort();

      if (low !== high) parent.set(high, low);
    }
  }

  return root;
}

function isKeptApartOperation(operation: SplitOperation | undefined): boolean {
  const code = operation ? classifyOperationReason('split', operation) : null;

  return code !== null && KEPT_APART_SPLIT_REASONS.has(code);
}

// 크기 때문에 나눈 작업이 든 묶음의 상자마다 묶음 키와 «쪽» 키를 준다. 쪽은 크기 나누기를 빼고 이은 것이라,
// 크기로 나눈 뒤 한쪽을 다른 이유로 다시 나눈 상자끼리는 같은 쪽이다.
export function keptApartSplitsOf(
  links: readonly SplitLink[],
  operations: ReadonlyMap<string, SplitOperation>,
): Map<string, { family: string; side: string }> {
  const family = splitFamilyRoot(links);
  const side = splitFamilyRoot(links.filter((link) => !isKeptApartOperation(operations.get(link.operationId))));
  const apartFamilies = new Set(
    links
      .filter((link) => isKeptApartOperation(operations.get(link.operationId)))
      .map((link) => family(link.shipmentId)),
  );
  const result = new Map<string, { family: string; side: string }>();

  for (const link of links) {
    const key = family(link.shipmentId);

    if (apartFamilies.has(key)) {
      result.set(link.shipmentId, { family: key, side: side(link.shipmentId) });
    }
  }

  return result;
}

export function isKeptApart(splits: KeptApartSplits, a: string, b: string): boolean {
  const left = splits.get(a);
  const right = splits.get(b);

  return left !== undefined && right !== undefined && left.family === right.family && left.side !== right.side;
}

function isLater(operation: SplitOperation, than: SplitOperation): boolean {
  const at = operation.completedAtMicros ?? 0;
  const thanAt = than.completedAtMicros ?? 0;

  return at > thanAt || (at === thanAt && operation.id > than.id);
}

// 이 상자가 든 가장 최근 나누기의 사유. 정해 둔 사유면 그 이름, 기타·옛 기록이면 적어 둔 글 그대로.
export function splitReasonOf(
  shipmentId: string,
  links: readonly SplitLink[],
  operations: ReadonlyMap<string, SplitOperation>,
): { reasonCode: string | null; reason: string } | null {
  let latest: SplitOperation | null = null;

  for (const link of links) {
    const operation = link.shipmentId === shipmentId ? operations.get(link.operationId) : undefined;

    if (operation && (!latest || isLater(operation, latest))) {
      latest = operation;
    }
  }

  if (!latest) return null;

  const reasonCode = classifyOperationReason('split', latest);
  const option =
    reasonCode && reasonCode !== 'other'
      ? SHIPMENT_OPERATION_REASONS.split.find((entry) => entry.code === reasonCode)
      : undefined;

  return { reasonCode, reason: option?.label ?? latest.reason };
}

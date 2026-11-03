import { isWaybillIssued } from '@/lib/services/orders/waybill-policy';

const OPEN_ENDING_DIGITS = new Set(['2', '4', '5', '9']);

type JosaPair = [open: string, closed: string];

const WITH: JosaPair = ['와', '과'];
const OBJECT: JosaPair = ['를', '을'];
const SUBJECT: JosaPair = ['가', '이'];

function josa(word: string, pair: JosaPair): string {
  return OPEN_ENDING_DIGITS.has(word.slice(-1)) ? pair[0] : pair[1];
}

function mergeSubject(orderNos: string[], last: JosaPair): string | null {
  const unique = [...new Set(orderNos)];

  if (unique.length < 2) {
    return null;
  }

  if (unique.length === 2) {
    const [first, second] = unique;

    return `#${first}${josa(first, WITH)} #${second}${josa(second, last)}`;
  }

  return `#${unique[0]} 외 ${unique.length - 1}건${last[1]}`;
}

export function mergingHeading(orderNos: string[]): string | null {
  const subject = mergeSubject(orderNos, OBJECT);

  return subject ? `${subject} 합치는 중이에요` : null;
}

export function mergedHeading(orderNos: string[]): string | null {
  const subject = mergeSubject(orderNos, SUBJECT);

  return subject ? `${subject} 새 상자 하나로 합쳐졌어요` : null;
}

export type NextStepKey = 'plan' | 'waybill' | 'batch';

export type NextStepState = 'done' | 'current' | 'later';

export interface NextStep {
  key: NextStepKey;
  title: string;
  state: NextStepState;
}

export function nextStepsAfterMerge(target: {
  status: string;
  waybills: Array<{ status: string }>;
  workItems: Array<{ status: string }>;
}): NextStep[] {
  const done: Record<NextStepKey, boolean> = {
    plan: target.status !== 'draft',
    waybill: target.waybills.some((waybill) => isWaybillIssued(waybill.status)),
    batch: target.workItems.some((item) => item.status !== 'excluded'),
  };
  const steps: Array<{ key: NextStepKey; title: string }> = [
    { key: 'plan', title: '계획 확정' },
    { key: 'waybill', title: '운송장 발급' },
    { key: 'batch', title: '배치 넣기' },
  ];
  const currentIndex = steps.findIndex((step) => !done[step.key]);

  return steps.map((step, index) => {
    if (done[step.key]) {
      return { ...step, state: 'done' };
    }

    return { ...step, state: index === currentIndex ? 'current' : 'later' };
  });
}

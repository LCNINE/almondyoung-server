import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { rememberBoxLabel } from '../../core/operations/boxChecks';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import {
  useBoxChecks,
  useUnresolvedWork,
} from '../../core/operations/workArea';
import { formatTrackingNo } from './inspection';

/**
 * 이 박스에 결과를 모르는 작업이 남았다 — 박스 화면은 막히지만 기기는 막지 않는다. 남은 작업은 저장돼 있어
 * 박스를 다시 열거나 «확인할 일» 에서 같은 키로 다시 맞춘다. 작업 영역(inert) 밖에 둔다
 */
export function BoxCheckingExit({
  shipmentId,
  trackingNo,
}: {
  shipmentId: string;
  /** «확인할 일» 목록이 이 박스를 송장으로 보이게 남긴다 */
  trackingNo?: string;
}) {
  const checks = useBoxChecks(shipmentId);
  const runtime = useWorkRuntime();
  const scope = checks[0]?.scope;
  useEffect(() => {
    if (!runtime || !scope || !trackingNo) return;
    void rememberBoxLabel(runtime.store, scope, shipmentId, {
      trackingNo: formatTrackingNo(trackingNo),
    }).catch(() => {});
  }, [runtime, scope, shipmentId, trackingNo]);
  const { recheck } = useUnresolvedWork();
  const [checking, setChecking] = useState(false);
  if (checks.length === 0) return null;
  return (
    <section
      role="status"
      className="space-y-2 rounded border-2 border-[#D99A00] bg-[#FFF1C7] p-3 text-[#5E3B00]"
    >
      <p className="font-semibold">
        이 박스의 처리 여부를 확인하고 있어요. 같은 상품은 다시 찍지 마세요.
      </p>
      <p className="text-sm">
        다른 박스는 그대로 작업해도 돼요. 결과는 «확인할 일»에서 다시 확인할 수
        있어요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              await recheck();
            } finally {
              setChecking(false);
            }
          }}
        >
          처리 내역 확인
        </Button>
        <Link to="/outbound">
          <Button>다른 박스 작업하기</Button>
        </Link>
      </div>
    </section>
  );
}

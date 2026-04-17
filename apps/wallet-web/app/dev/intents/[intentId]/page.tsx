import { notFound } from 'next/navigation';
import { eq, or } from 'drizzle-orm';
import {
  db,
  paymentIntents,
  paymentMethods,
  charges,
  refunds,
  paymentStateTransitions,
  outboxEvents,
  pointEvents,
  pointHolds,
  paymentIntentItems,
  type Charge,
  type Refund,
  type PaymentStateTransition,
  type OutboxEvent,
  type PointEvent,
  type PointHold,
  type PaymentIntentItem,
} from '@/lib/wallet-db';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export const dynamic = 'force-dynamic';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(date: Date | null | undefined) {
  if (!date) return '-';
  return format(date, 'yyyy-MM-dd HH:mm:ss', { locale: ko });
}

function maskSecret(s: string) {
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

const INTENT_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    CREATED: 'secondary',
    PROCESSING: 'default',
    REQUIRES_ACTION: 'outline',
    SUCCEEDED: 'default',
    FAILED: 'destructive',
    CANCELED: 'outline',
  };

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-2 bg-muted/40">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ─── KV row ───────────────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono break-all">{value ?? '-'}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function IntentDetailPage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;

  // 1. Intent
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .limit(1);

  if (!intent) notFound();

  // 2~10. 병렬 조회
  const [
    methodRows,
    chargeRows,
    refundRows,
    outboxRows,
    pointEventRows,
    pointHoldRows,
    itemRows,
  ] = await Promise.all([
    intent.paymentMethodId
      ? db
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.id, intent.paymentMethodId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(charges)
      .where(eq(charges.intentId, intentId)),
    db
      .select()
      .from(refunds)
      .where(eq(refunds.intentId, intentId)),
    db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, intentId)),
    db
      .select()
      .from(pointEvents)
      .where(eq(pointEvents.intentId, intentId)),
    db
      .select()
      .from(pointHolds)
      .where(eq(pointHolds.intentId, intentId)),
    db
      .select()
      .from(paymentIntentItems)
      .where(eq(paymentIntentItems.intentId, intentId)),
  ]);

  const method = methodRows[0] ?? null;
  const chargeList: Charge[] = chargeRows;
  const refundList: Refund[] = refundRows;
  const outboxList: OutboxEvent[] = outboxRows;
  const pointEventList: PointEvent[] = pointEventRows;
  const pointHoldList: PointHold[] = pointHoldRows;
  const itemList: PaymentIntentItem[] = itemRows;

  // state transitions: intent + charge + refund IDs
  const relatedIds = [intentId, ...chargeList.map((c) => c.id), ...refundList.map((r) => r.id)];
  const transitionRows: PaymentStateTransition[] = await db
    .select()
    .from(paymentStateTransitions)
    .where(
      relatedIds.length === 1
        ? eq(paymentStateTransitions.entityId, intentId)
        : or(...relatedIds.map((id) => eq(paymentStateTransitions.entityId, id))),
    )
    .then((rows) => rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()));

  return (
    <div className="space-y-4">
      {/* Back link */}
      <div className="text-sm">
        <a href="/dev/intents" className="text-muted-foreground hover:underline">
          ← 목록으로
        </a>
      </div>

      <h1 className="text-xl font-bold font-mono break-all">{intent.id}</h1>

      {/* ── Intent ── */}
      <Section title="Intent">
        <div className="space-y-1.5">
          <KV
            label="status"
            value={
              <Badge variant={INTENT_STATUS_VARIANT[intent.status] ?? 'secondary'}>
                {intent.status}
              </Badge>
            }
          />
          <KV label="amount" value={`${intent.payableAmount.toLocaleString()} ${intent.currency}`} />
          <KV label="version" value={String(intent.version)} />
          <KV label="clientSecret" value={maskSecret(intent.clientSecret)} />
          <KV label="returnUrl" value={intent.returnUrl} />
          <KV label="expiresAt" value={fmt(intent.expiresAt)} />
          <KV label="createdAt" value={fmt(intent.createdAt)} />
          <KV label="updatedAt" value={fmt(intent.updatedAt)} />
        </div>
      </Section>

      {/* ── User ── */}
      <Section title="User">
        <div className="space-y-1.5">
          <KV label="userId" value={intent.userId} />
        </div>
      </Section>

      {/* ── Payment Method ── */}
      <Section title="Payment Method">
        {method ? (
          <div className="space-y-1.5">
            <KV label="type" value={<Badge variant="outline">{method.type}</Badge>} />
            <KV label="displayName" value={method.displayName} />
            <KV label="id" value={method.id} />
            <KV label="isReusable" value={String(method.isReusable)} />
            <KV label="isDeleted" value={String(method.isDeleted)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">없음</p>
        )}
      </Section>

      {/* ── Charges ── */}
      <Section title={`Charges (${chargeList.length})`}>
        {chargeList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1 pr-4 font-medium">Op</th>
                  <th className="text-left py-1 pr-4 font-medium">Status</th>
                  <th className="text-right py-1 pr-4 font-medium">Amount</th>
                  <th className="text-left py-1 pr-4 font-medium">ProviderTxId</th>
                  <th className="text-left py-1 pr-4 font-medium">ErrorCode</th>
                  <th className="text-left py-1 pr-4 font-medium">ErrorMessage</th>
                  <th className="text-left py-1 font-medium">createdAt</th>
                </tr>
              </thead>
              <tbody>
                {chargeList.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-mono">{c.operation}</td>
                    <td className="py-1.5 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {c.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {c.amount.toLocaleString()} {c.currency}
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-muted-foreground">
                      {c.providerTransactionId ?? '-'}
                    </td>
                    <td className="py-1.5 pr-4 text-destructive">{c.errorCode ?? '-'}</td>
                    <td className="py-1.5 pr-4 max-w-[200px] truncate text-muted-foreground">
                      {c.errorMessage ?? '-'}
                    </td>
                    <td className="py-1.5 font-mono text-muted-foreground">{fmt(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Refunds ── */}
      <Section title={`Refunds (${refundList.length})`}>
        {refundList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-right py-1 pr-4 font-medium">Amount</th>
                  <th className="text-left py-1 pr-4 font-medium">Status</th>
                  <th className="text-left py-1 pr-4 font-medium">ReasonCode</th>
                  <th className="text-left py-1 pr-4 font-medium">ProviderRefundId</th>
                  <th className="text-left py-1 font-medium">createdAt</th>
                </tr>
              </thead>
              <tbody>
                {refundList.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {r.amount.toLocaleString()} {r.currency}
                    </td>
                    <td className="py-1.5 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-4 font-mono">{r.reasonCode ?? '-'}</td>
                    <td className="py-1.5 pr-4 font-mono text-muted-foreground">
                      {r.providerRefundId ?? '-'}
                    </td>
                    <td className="py-1.5 font-mono text-muted-foreground">{fmt(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Point Holds ── */}
      <Section title={`Point Holds (${pointHoldList.length})`}>
        {pointHoldList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-right py-1 pr-4 font-medium">Amount</th>
                  <th className="text-left py-1 pr-4 font-medium">Status</th>
                  <th className="text-left py-1 font-medium">createdAt</th>
                </tr>
              </thead>
              <tbody>
                {pointHoldList.map((h) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {h.amount.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {h.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 font-mono text-muted-foreground">{fmt(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Point Events ── */}
      <Section title={`Point Events (${pointEventList.length})`}>
        {pointEventList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1 pr-4 font-medium">EventType</th>
                  <th className="text-right py-1 pr-4 font-medium">Amount</th>
                  <th className="text-left py-1 pr-4 font-medium">ReasonCode</th>
                  <th className="text-left py-1 font-medium">createdAt</th>
                </tr>
              </thead>
              <tbody>
                {pointEventList.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">
                      <Badge variant="secondary" className="text-xs font-mono">
                        {e.eventType}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {e.amount.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-4 font-mono">{e.reasonCode ?? '-'}</td>
                    <td className="py-1.5 font-mono text-muted-foreground">{fmt(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── State Transitions ── */}
      <Section title={`State Transitions (${transitionRows.length})`}>
        {transitionRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1 pr-4 font-medium">Entity</th>
                  <th className="text-left py-1 pr-4 font-medium">Prev → New</th>
                  <th className="text-left py-1 pr-4 font-medium">TriggeredBy</th>
                  <th className="text-left py-1 pr-4 font-medium">correlationId</th>
                  <th className="text-left py-1 font-medium">occurredAt</th>
                </tr>
              </thead>
              <tbody>
                {transitionRows.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">
                      <Badge variant="outline" className="text-xs font-mono">
                        {t.entityType}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-4 font-mono">
                      {t.previousStatus ?? '∅'} → {t.newStatus}
                    </td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {t.triggeredByType}
                      {t.triggeredById ? `:${t.triggeredById}` : ''}
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-muted-foreground max-w-[120px] truncate">
                      {t.correlationId}
                    </td>
                    <td className="py-1.5 font-mono text-muted-foreground">
                      {fmt(t.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Outbox Events ── */}
      <Section title={`Outbox Events (${outboxList.length})`}>
        {outboxList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1 pr-4 font-medium">EventType</th>
                  <th className="text-left py-1 pr-4 font-medium">Status</th>
                  <th className="text-right py-1 pr-4 font-medium">Attempts</th>
                  <th className="text-left py-1 font-medium">createdAt</th>
                </tr>
              </thead>
              <tbody>
                {outboxList.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-mono">{o.eventType}</td>
                    <td className="py-1.5 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {o.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{o.attempts}</td>
                    <td className="py-1.5 font-mono text-muted-foreground">{fmt(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Intent Items ── */}
      <Section title={`Intent Items (${itemList.length})`}>
        {itemList.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1 pr-4 font-medium">Name</th>
                  <th className="text-right py-1 pr-4 font-medium">UnitPrice</th>
                  <th className="text-right py-1 pr-4 font-medium">Qty</th>
                  <th className="text-right py-1 font-medium">Payable</th>
                </tr>
              </thead>
              <tbody>
                {itemList.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{item.name}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {item.unitPrice.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {item.payableAmount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

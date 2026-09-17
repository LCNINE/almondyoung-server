import { Button } from '../../core/design/Button';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import type { OutboundSourceLine } from './types';
export function OutboundSourcePicker({
  sources,
  disabled,
  onSelect,
  onCode,
}: {
  sources: OutboundSourceLine[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onCode: (code: string) => void;
}) {
  const locations = [
    ...new Map(
      sources
        .filter((source) => source.remainingQty > 0)
        .map((source) => [source.sourceLocationId, source])
    ).values(),
  ];
  return (
    <section className="space-y-2 rounded border p-3">
      <h2 className="font-semibold">출발 위치 선택</h2>
      <BarcodeInput
        label="출발 위치 코드"
        disabled={disabled}
        onSubmit={onCode}
      />
      <div className="flex flex-wrap gap-2">
        {locations.map((location) => (
          <Button
            key={location.sourceLocationId}
            disabled={disabled}
            aria-label={`${location.sourceLocationCode} 선택`}
            onClick={() => onSelect(location.sourceLocationId)}
          >
            {location.sourceLocationCode}
          </Button>
        ))}
      </div>
    </section>
  );
}

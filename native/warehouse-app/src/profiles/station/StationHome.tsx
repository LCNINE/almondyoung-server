import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { DiagnosticsScreen } from '../shared/DiagnosticsScreen';

export function StationHome() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (showDiagnostics) {
    return (
      <div data-testid="station-home">
        <Button className="mb-4" onClick={() => setShowDiagnostics(false)}>
          Back
        </Button>
        <DiagnosticsScreen />
      </div>
    );
  }

  return (
    <div data-testid="station-home">
      Station profile
      <Button className="mt-4" onClick={() => setShowDiagnostics(true)}>
        Diagnostics
      </Button>
    </div>
  );
}

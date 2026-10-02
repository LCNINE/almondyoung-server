import { useContext } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { ShellChromeContext } from '../../core/design/shellChrome';
import { DiagnosticsScreen } from '../../profiles/shared/DiagnosticsScreen';

// Glue: not unit-tested in isolation (see DiagnosticsScreen.test.tsx, which
// renders DiagnosticsScreen bare — no router). Always mounted inside the
// route tree, so the <Link> here is safe. Provides the only in-app way back
// to the profile home; desktop/station has no hardware back button.
export function DiagnosticsRoute() {
  const { hidesHomeBack } = useContext(ShellChromeContext);
  return (
    <div className="space-y-4">
      {!hidesHomeBack && (
        <Link to="/">
          <Button>← Home</Button>
        </Link>
      )}
      <DiagnosticsScreen />
    </div>
  );
}

import { useContext } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { ShellChromeContext } from '../../core/design/shellChrome';
import { InventoryLookupScreen } from '../../domains/inventory/InventoryLookupScreen';

export function InventoryLookupRoute() {
  const { hidesHomeBack } = useContext(ShellChromeContext);
  return (
    <div className="space-y-4">
      {!hidesHomeBack && (
        <Link to="/">
          <Button>← 홈</Button>
        </Link>
      )}
      <InventoryLookupScreen />
    </div>
  );
}

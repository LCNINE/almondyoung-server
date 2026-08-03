import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { InventoryLookupScreen } from '../../domains/inventory/InventoryLookupScreen';

export function InventoryLookupRoute() {
  return (
    <div className="space-y-4">
      <Link to="/">
        <Button>← 홈</Button>
      </Link>
      <InventoryLookupScreen />
    </div>
  );
}

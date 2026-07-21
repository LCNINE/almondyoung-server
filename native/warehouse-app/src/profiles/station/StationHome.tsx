import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';

export function StationHome() {
  return (
    <div data-testid="station-home" className="space-y-4">
      <p>Station profile</p>
      <Link to="/diagnostics">
        <Button>Diagnostics</Button>
      </Link>
    </div>
  );
}

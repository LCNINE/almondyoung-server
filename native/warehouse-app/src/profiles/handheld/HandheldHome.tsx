import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';

export function HandheldHome() {
  return (
    <div data-testid="handheld-home" className="space-y-4">
      <p>Handheld profile</p>
      <Link to="/diagnostics">
        <Button>Diagnostics</Button>
      </Link>
    </div>
  );
}

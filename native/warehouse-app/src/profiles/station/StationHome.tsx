import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { Link } from '@tanstack/react-router';
import {
  Search,
  PackageCheck,
  PackagePlus,
  ClipboardList,
  ArrowLeftRight,
  ClipboardCheck,
  Wrench,
  Settings,
} from 'lucide-react';
import { TileGrid, HubTile } from '../../core/design/HubTile';

export function StationHome() {
  const developer = useDeveloperMode();
  return (
    <div data-testid="station-home" className="space-y-4">
      <TileGrid>
        <Link to="/inventory">
          <HubTile icon={Search} label="재고조회" />
        </Link>
        <Link to="/outbound">
          <HubTile icon={PackageCheck} label="출고작업" />
        </Link>
        <Link to="/inbound">
          <HubTile icon={PackagePlus} label="입고" />
        </Link>
        <Link to="/putaway">
          <HubTile icon={ClipboardList} label="적치" />
        </Link>
        <Link to="/movement">
          <HubTile icon={ArrowLeftRight} label="이동" />
        </Link>
        <Link to="/stocktaking">
          <HubTile icon={ClipboardCheck} label="실사" />
        </Link>
        {developer.enabled && (
          <Link to="/diagnostics">
            <HubTile icon={Wrench} label="개발자 진단" />
          </Link>
        )}
        <Link to="/settings">
          <HubTile icon={Settings} label="설정" />
        </Link>
      </TileGrid>
    </div>
  );
}

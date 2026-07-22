import { Link } from '@tanstack/react-router';
import {
  Search,
  ClipboardCheck,
  ArrowLeftRight,
  PackagePlus,
  ListChecks,
  Wrench,
  Settings,
} from 'lucide-react';
import { TileGrid, HubTile } from '../../core/design/HubTile';

export function HandheldHome() {
  return (
    <div data-testid="handheld-home" className="space-y-4">
      <TileGrid>
        <Link to="/inventory"><HubTile icon={Search} label="재고조회" /></Link>
        <Link to="/stocktaking"><HubTile icon={ClipboardCheck} label="실사" /></Link>
        <Link to="/movement"><HubTile icon={ArrowLeftRight} label="이동" /></Link>
        <Link to="/inbound"><HubTile icon={PackagePlus} label="입고/검수" /></Link>
        <Link to="/picking"><HubTile icon={ListChecks} label="피킹" /></Link>
        <Link to="/diagnostics"><HubTile icon={Wrench} label="진단" /></Link>
        <Link to="/settings"><HubTile icon={Settings} label="설정" /></Link>
      </TileGrid>
    </div>
  );
}

import { Link } from '@tanstack/react-router';
import { Search, PackageCheck, Truck, Wrench, Settings } from 'lucide-react';
import { TileGrid, HubTile } from '../../core/design/HubTile';

export function StationHome() {
  return (
    <div data-testid="station-home" className="space-y-4">
      <TileGrid>
        <Link to="/inventory"><HubTile icon={Search} label="재고조회" /></Link>
        <Link to="/packing"><HubTile icon={PackageCheck} label="패킹" /></Link>
        <Link to="/shipments"><HubTile icon={Truck} label="출고조회" /></Link>
        <Link to="/diagnostics"><HubTile icon={Wrench} label="진단" /></Link>
        <Link to="/settings"><HubTile icon={Settings} label="설정" /></Link>
      </TileGrid>
    </div>
  );
}

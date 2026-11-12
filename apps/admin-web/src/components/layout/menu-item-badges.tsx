'use client';

import { type MenuItem } from '@/lib/utils/menu';
import { QuarantineMenuBadge } from './quarantine-menu-badge';
import { PrintOrderMenuBadge } from './print-order-menu-badge';
import {
  ConsolidationMenuBadge,
  OutboundPreparationMenuBadge,
} from './shipment-menu-badges';

export function MenuItemBadges({ item }: { item: MenuItem }) {
  return (
    <>
      {item.hasQuarantineBadge && <QuarantineMenuBadge />}
      {item.hasPrintOrderBadge && <PrintOrderMenuBadge />}
      {item.hasOutboundPreparationBadge && <OutboundPreparationMenuBadge />}
      {item.hasConsolidationBadge && <ConsolidationMenuBadge />}
    </>
  );
}

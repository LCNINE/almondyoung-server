type LocationFacts = { id: string; warehouseId: string; isActive: boolean; isSystem: boolean };
type DestinationIssue = 'MISSING' | 'WRONG_WAREHOUSE' | 'SAME_LOCATION' | 'INACTIVE' | 'SYSTEM';

export function destinationIssue(input: {
  purpose: 'movement' | 'putaway';
  warehouseId: string;
  sourceLocationId: string;
  destination: LocationFacts | null;
}): DestinationIssue | null {
  const { destination, warehouseId, sourceLocationId, purpose } = input;
  if (!destination) return 'MISSING';
  if (destination.warehouseId !== warehouseId) return 'WRONG_WAREHOUSE';
  if (destination.id === sourceLocationId) return 'SAME_LOCATION';
  if (purpose === 'putaway' && destination.isSystem) return 'SYSTEM';
  if (!destination.isActive) return 'INACTIVE';
  return null;
}

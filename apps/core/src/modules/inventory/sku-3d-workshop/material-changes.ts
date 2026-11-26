export type MaterialInputs = {
  photos: { fileId: string }[];
  sku: {
    packageWidthMm: number | null;
    packageLengthMm: number | null;
    packageHeightMm: number | null;
    packageWeightG: number | null;
    dimensionBasis: string;
  };
};

type Dimensions = Omit<MaterialInputs['sku'], 'dimensionBasis'> & { dimensionBasis: string };

export type MaterialChanges = {
  addedPhotos: string[];
  removedPhotos: string[];
  dimensions: { before: Dimensions; after: Dimensions } | null;
};

const DIMENSION_KEYS = [
  'packageWidthMm',
  'packageLengthMm',
  'packageHeightMm',
  'packageWeightG',
  'dimensionBasis',
] as const;

// 마지막 버전을 만든 입력과 지금 실측 자료의 차이. 같으면 null
export function materialChanges(before: MaterialInputs | null, after: MaterialInputs): MaterialChanges | null {
  if (!before) {
    return null;
  }

  const beforeIds = new Set(before.photos.map((p) => p.fileId));
  const afterIds = new Set(after.photos.map((p) => p.fileId));
  const addedPhotos = [...afterIds].filter((id) => !beforeIds.has(id));
  const removedPhotos = [...beforeIds].filter((id) => !afterIds.has(id));
  const dimensionsChanged = DIMENSION_KEYS.some((key) => before.sku[key] !== after.sku[key]);

  if (addedPhotos.length === 0 && removedPhotos.length === 0 && !dimensionsChanged) {
    return null;
  }

  return {
    addedPhotos,
    removedPhotos,
    dimensions: dimensionsChanged ? { before: pick(before.sku), after: pick(after.sku) } : null,
  };
}

// 버전 기록(provenance.inputs)은 jsonb 라 모양을 확인하고 쓴다
export function materialInputsOf(provenance: Record<string, unknown> | null | undefined): MaterialInputs | null {
  const inputs = provenance?.inputs;

  if (typeof inputs !== 'object' || inputs === null || !('photos' in inputs) || !('sku' in inputs)) {
    return null;
  }

  const { photos, sku } = inputs;

  if (!Array.isArray(photos) || typeof sku !== 'object' || sku === null) {
    return null;
  }

  return {
    photos: photos
      .filter((p): p is { fileId: string } => typeof p === 'object' && p !== null && typeof p.fileId === 'string')
      .map((p) => ({ fileId: p.fileId })),
    sku: {
      packageWidthMm: numberOrNull(sku, 'packageWidthMm'),
      packageLengthMm: numberOrNull(sku, 'packageLengthMm'),
      packageHeightMm: numberOrNull(sku, 'packageHeightMm'),
      packageWeightG: numberOrNull(sku, 'packageWeightG'),
      dimensionBasis:
        'dimensionBasis' in sku && typeof sku.dimensionBasis === 'string' ? sku.dimensionBasis : 'unknown',
    },
  };
}

function numberOrNull(value: object, key: string): number | null {
  const found: unknown = Object.entries(value).find(([k]) => k === key)?.[1];

  return typeof found === 'number' ? found : null;
}

function pick(sku: MaterialInputs['sku']): Dimensions {
  return {
    packageWidthMm: sku.packageWidthMm,
    packageLengthMm: sku.packageLengthMm,
    packageHeightMm: sku.packageHeightMm,
    packageWeightG: sku.packageWeightG,
    dimensionBasis: sku.dimensionBasis,
  };
}

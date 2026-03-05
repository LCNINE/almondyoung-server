/** @format */

'use client';

interface BarcodeProps {
  value: string;
}

export default function Barcode({ value }: BarcodeProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width="120"
        height="50"
        viewBox="0 0 120 50"
        className="bg-card"
        aria-label={`Barcode: ${value}`}
      >
        {/* Simple barcode representation */}
        <rect x="5" y="5" width="2" height="40" fill="currentColor" />
        <rect x="10" y="5" width="1" height="40" fill="currentColor" />
        <rect x="13" y="5" width="3" height="40" fill="currentColor" />
        <rect x="18" y="5" width="1" height="40" fill="currentColor" />
        <rect x="21" y="5" width="2" height="40" fill="currentColor" />
        <rect x="25" y="5" width="1" height="40" fill="currentColor" />
        <rect x="28" y="5" width="3" height="40" fill="currentColor" />
        <rect x="33" y="5" width="2" height="40" fill="currentColor" />
        <rect x="37" y="5" width="1" height="40" fill="currentColor" />
        <rect x="40" y="5" width="2" height="40" fill="currentColor" />
        <rect x="44" y="5" width="3" height="40" fill="currentColor" />
        <rect x="49" y="5" width="1" height="40" fill="currentColor" />
        <rect x="52" y="5" width="2" height="40" fill="currentColor" />
        <rect x="56" y="5" width="1" height="40" fill="currentColor" />
        <rect x="59" y="5" width="3" height="40" fill="currentColor" />
        <rect x="64" y="5" width="2" height="40" fill="currentColor" />
        <rect x="68" y="5" width="1" height="40" fill="currentColor" />
        <rect x="71" y="5" width="2" height="40" fill="currentColor" />
        <rect x="75" y="5" width="3" height="40" fill="currentColor" />
        <rect x="80" y="5" width="1" height="40" fill="currentColor" />
        <rect x="83" y="5" width="2" height="40" fill="currentColor" />
        <rect x="87" y="5" width="1" height="40" fill="currentColor" />
        <rect x="90" y="5" width="3" height="40" fill="currentColor" />
        <rect x="95" y="5" width="2" height="40" fill="currentColor" />
        <rect x="99" y="5" width="1" height="40" fill="currentColor" />
        <rect x="102" y="5" width="2" height="40" fill="currentColor" />
        <rect x="106" y="5" width="3" height="40" fill="currentColor" />
        <rect x="111" y="5" width="1" height="40" fill="currentColor" />
      </svg>
    </div>
  );
}

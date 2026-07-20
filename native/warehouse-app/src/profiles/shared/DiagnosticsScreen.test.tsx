import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { DiagnosticsScreen } from './DiagnosticsScreen';

describe('DiagnosticsScreen', () => {
  it('mounts within ScanProvider and shows the diagnostics sections', () => {
    render(
      <ScanProvider>
        <DiagnosticsScreen />
      </ScanProvider>
    );
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /camera scan/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /test print/i })
    ).toBeInTheDocument();
  });
});

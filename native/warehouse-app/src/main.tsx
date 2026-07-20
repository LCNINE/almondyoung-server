import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { platform } from '@tauri-apps/plugin-os';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './app/App';
import { resolveProfile, type Profile } from './app/profile';
import { StationHome } from './profiles/station/StationHome';
import { HandheldHome } from './profiles/handheld/HandheldHome';
import { ScanProvider } from './core/hardware/scan/ScanProvider';
import { queryClient } from './core/data/queryClient';

// platform() is synchronous in plugin-os v2, so profile resolution needs no
// async bootstrap — it runs inline before the initial render.
const profile: Profile = resolveProfile(platform());
const home = profile === 'station' ? <StationHome /> : <HandheldHome />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScanProvider>
        <App>{home}</App>
      </ScanProvider>
    </QueryClientProvider>
  </StrictMode>
);

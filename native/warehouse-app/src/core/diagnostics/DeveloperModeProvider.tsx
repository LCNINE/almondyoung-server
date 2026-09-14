import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useIsAuthenticated } from '../../app/session-context';
import { useApiClient } from '../data/ApiClientProvider';
const Context = createContext({ enabled: false, toggle: async () => {} });
export const useDeveloperMode = () => useContext(Context);
export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const authed = useIsAuthenticated();
  const [enabled, setEnabled] = useState(false);
  const check = () => api.request({ path: '/inventory/diagnostics-access' });
  useEffect(() => {
    if (!authed) setEnabled(false);
  }, [authed]);
  useEffect(() => {
    if (!enabled) return;
    const verify = () => {
      void check().catch(() => setEnabled(false));
    };
    const timer = setInterval(verify, 60000);
    window.addEventListener('focus', verify);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', verify);
    };
  }, [enabled, api]);
  return (
    <Context.Provider
      value={{
        enabled: enabled && authed,
        toggle: async () => {
          if (enabled) {
            setEnabled(false);
            return;
          }
          try {
            await check();
            setEnabled(true);
          } catch {
            setEnabled(false);
          }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

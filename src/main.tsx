import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/index.css';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { App } from './App';
import { registerServiceWorker } from '@/lib/pwa';
import { initPerformanceMonitoring } from '@/lib/performance';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Remove the boot skeleton once React has mounted.
function removeSkeleton() {
  document.getElementById('boot-skeleton')?.remove();
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

// These run after first paint so they never delay interactivity.
if (typeof window !== 'undefined') {
  window.requestAnimationFrame(removeSkeleton);
  registerServiceWorker();
  initPerformanceMonitoring();
}

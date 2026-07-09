const showRuntimeCrashOverlay = (title: string, errorLike: unknown): void => {
  const error = errorLike instanceof Error ? errorLike : undefined;
  const errorMessage =
    error?.message ?? (typeof errorLike === 'string' ? errorLike : 'Unknown runtime error');
  const errorStack =
    error?.stack ?? (errorLike && typeof errorLike === 'object' && 'stack' in errorLike
      ? String((errorLike as { stack?: unknown }).stack)
      : '');

  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100vw',
    'height:100vh',
    'background:#7f0000',
    'color:#ffffff',
    'padding:20px',
    'z-index:999999',
    'overflow:scroll',
    'font-family:monospace',
    'font-size:14px',
    'line-height:1.45',
    'white-space:pre-wrap',
    'box-sizing:border-box',
  ].join(';');
  errorDiv.innerText = `${title}\n\nmessage:\n${errorMessage}\n\nstack:\n${errorStack || 'No stack available'}`;
  (document.body || document.documentElement).appendChild(errorDiv);
};

window.addEventListener('error', event => {
  showRuntimeCrashOverlay('🚨 RUNTIME CRASH DETECTED', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', event => {
  showRuntimeCrashOverlay('🚨 UNHANDLED PROMISE REJECTION DETECTED', event.reason);
});

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { PlatformProvider } from './context/PlatformContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider>
      <App />
    </PlatformProvider>
  </StrictMode>,
);

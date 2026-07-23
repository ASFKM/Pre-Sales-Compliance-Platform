import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {DiagnosticsErrorBoundary} from './diagnostics/ErrorBoundary';
import {installGlobalDiagnosticsHandlers} from './diagnostics/globalHandlers';

installGlobalDiagnosticsHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagnosticsErrorBoundary>
      <App />
    </DiagnosticsErrorBoundary>
  </StrictMode>,
);

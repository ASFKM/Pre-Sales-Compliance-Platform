import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {DiagnosticsErrorBoundary} from './diagnostics/ErrorBoundary';
import {installGlobalDiagnosticsHandlers} from './diagnostics/globalHandlers';
import BugReportButton from './diagnostics/BugReportButton';

installGlobalDiagnosticsHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagnosticsErrorBoundary>
      <App />
      <BugReportButton />
    </DiagnosticsErrorBoundary>
  </StrictMode>,
);

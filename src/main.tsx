import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LabProvider } from './lab/store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/lab.css';
import './styles/rig.css';
import './styles/screens.css';
import './styles/mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabProvider>
      <App />
    </LabProvider>
  </StrictMode>,
);

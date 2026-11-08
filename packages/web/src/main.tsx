import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { registerPwa } from './shared/pwa';
import './shared/styles/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();

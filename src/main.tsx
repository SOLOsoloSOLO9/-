import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dismiss the transitional splash screen smoothly once React mounts
const splash = document.getElementById('app-splash');
if (splash) {
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.remove();
  }, 500);
}

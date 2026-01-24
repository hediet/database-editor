import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'golden-layout/dist/css/goldenlayout-base.css';
import './global.css';

const rootEl = document.getElementById('root')!;
rootEl.style.height = '100vh';
rootEl.style.margin = '0';
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';

createRoot(rootEl).render(<App />);

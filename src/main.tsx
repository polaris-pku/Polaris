import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdateDialog } from '@/components/UpdateDialog';
import './index.css';
import '@xyflow/react/dist/style.css';
import { installLocalWebBridge } from '@/api/webBridge';

async function bootstrap() {
  await installLocalWebBridge();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <UpdateDialog />
    </StrictMode>,
  );
}

void bootstrap();

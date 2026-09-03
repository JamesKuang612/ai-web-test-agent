import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../styles.css';
import { App } from './App';

/** 挂载本地测试控制台。 */
function main(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('找不到前端根节点。');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main();

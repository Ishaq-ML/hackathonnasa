import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import GlofPanel from './GlofPanel.jsx';
import './nisaster-glof.css';

let root;

// Mount only the observatory. The original React app starts a different map.
export function openGlofPanel(onShowOnMap) {
  if (!root) {
    const host = document.createElement('div');
    host.id = 'tp-glof-root';
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<GlofPanel className="nisaster-glof" onShowOnMap={onShowOnMap} />));
  }
  const dialog = document.getElementById('glof-monitor');
  if (!dialog.open) dialog.showModal();
}

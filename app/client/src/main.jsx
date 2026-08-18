import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/hall.css';
import './styles/match.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

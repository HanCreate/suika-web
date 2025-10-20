import React from 'react'
import { createRoot } from 'react-dom/client'
import SuikaGame from './SuikaGame'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuikaGame />
  </React.StrictMode>
)

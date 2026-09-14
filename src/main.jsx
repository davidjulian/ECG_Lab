import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter as BrowserRouter } from 'react-router-dom'
import { ModeProvider } from './context/ModeContext'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
        <ModeProvider>
          <App />
        </ModeProvider>
    </BrowserRouter>
  </StrictMode>
)

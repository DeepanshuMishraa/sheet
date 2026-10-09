import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { startSound } from './sound'
import './styles.css'

startSound()

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root, so the page has nowhere to mount.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

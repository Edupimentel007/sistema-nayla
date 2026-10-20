import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './app/App'
import { InstallPrompt } from './pwa'
import './app/styles.css'
import './pwa.css'
import './app/visual-refresh.css'
import './app/motion.css'
import './app/dark-theme.css'
import './app/mobile-assistant-launcher.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><InstallPrompt /></React.StrictMode>)

if (import.meta.env.PROD && !Capacitor.isNativePlatform() &&
  ['http:', 'https:'].includes(window.location.protocol) && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installation and online use continue if service workers are unavailable.
    })
  }, { once: true })
}

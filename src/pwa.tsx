import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function onIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function installed() {
  return Capacitor.isNativePlatform() || window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('nayla-install-dismissed') === '1' }
    catch { return false }
  })

  useEffect(() => {
    if (installed()) return
    setIos(onIOS())
    const ready = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallEvent)
    }
    const done = () => {
      setInstallEvent(null)
      setIos(false)
    }
    window.addEventListener('beforeinstallprompt', ready)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('beforeinstallprompt', ready)
      window.removeEventListener('appinstalled', done)
    }
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem('nayla-install-dismissed', '1') } catch { /* optional */ }
  }

  const install = async () => {
    if (!installEvent) {
      setInstructions(value => !value)
      return
    }
    try {
      await installEvent.prompt()
      await installEvent.userChoice
    } finally {
      setInstallEvent(null)
      dismiss()
    }
  }

  if (dismissed || (!installEvent && !ios)) return null

  return <aside className="pwa-install" aria-label="Instalação do Nayla">
    <button className="pwa-install-action" type="button" onClick={() => void install()}>
      <span className="pwa-install-icon" aria-hidden="true">✦</span>
      {installEvent ? 'Instalar Nayla' : 'Nayla na tela inicial'}
    </button>
    <button className="pwa-install-close" type="button" onClick={dismiss} aria-label="Ocultar opção de instalação">×</button>
    {ios && instructions && !installEvent ?
      <p>Toque em <strong>Compartilhar</strong> no navegador e escolha <strong>Adicionar à Tela de Início</strong>.</p> : null}
  </aside>
}

import { useEffect, useState } from 'react'
import { businessLogoSrc } from '../lib/businessLogo'
import './business-logo.css'

export function BusinessLogo({ name, logoUrl, className = '' }: {
  name: string
  logoUrl?: string | null
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [logoUrl])
  const source = logoUrl && !failed ? businessLogoSrc(logoUrl) : ''
  return <span className={`business-logo ${className}`} aria-label={`Logo de ${name}`}>
    {source ? <img src={source} alt="" onError={() => setFailed(true)} />
      : <span aria-hidden="true">{name.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'N'}</span>}
  </span>
}

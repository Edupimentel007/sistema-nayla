import { Clock3, Plus, Trash2 } from 'lucide-react'
import type { CatalogService, Specialty } from '../lib/api'
import { money, specialties } from './shared'
import './signup-service-selector.css'

type Props = {
  areas: Specialty[]
  services: CatalogService[]
  selected: string[]
  onToggle: (id: string) => void
  loading: boolean
  error: string
  onRetry: () => void
  customServices: CustomServiceDraft[]
  onAddCustom: () => void
  onUpdateCustom: (index: number, patch: Partial<CustomServiceDraft>) => void
  onRemoveCustom: (index: number) => void
}

export type CustomServiceDraft = { name: string; category: Specialty; price: string; durationMinutes: string }

export function SignupServiceSelector({ areas, services, selected, onToggle, loading, error, onRetry,
  customServices, onAddCustom, onUpdateCustom, onRemoveCustom }: Props) {
  if (!areas.length) return null
  const areasWithTemplates = areas.filter(area => area !== 'outros')
  const chosenCount = selected.length + customServices.filter(item => item.name.trim() && item.price.trim()).length
  return <section className="signup-services" aria-labelledby="signup-services-title">
    <div className="signup-services-heading"><div><h2 id="signup-services-title">Quais serviços você oferece?</h2>
      <p>Marque os serviços que devem aparecer no seu link de agendamento. Você poderá ajustar preços, duração e disponibilidade depois.</p></div>
      <strong>{chosenCount} {chosenCount === 1 ? 'serviço escolhido' : 'serviços escolhidos'}</strong></div>
    {loading && areasWithTemplates.length ? <p className="signup-services-status" role="status">Carregando opções de serviços...</p> : null}
    {error && areasWithTemplates.length ? <div className="signup-services-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Tentar novamente</button></div> : null}
    {!loading && !error ? <div className="signup-service-groups">{areasWithTemplates.map((area, index) => {
      const options = services.filter(item => item.category === area)
      if (!options.length) return null
      const count = options.filter(item => selected.includes(item.id)).length
      return <details className="signup-service-group" key={area} open={index === 0}>
        <summary><span>{specialties[area]}</span><small>{count} de {options.length} escolhidos</small></summary>
        <div className="signup-service-list">{options.map(item => <label className="signup-service-option" key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
          <span><strong>{item.name}</strong><small><Clock3 size={13} aria-hidden="true" /> {item.durationMinutes} min · valor inicial {money(item.price)}</small></span>
        </label>)}</div>
      </details>
    })}</div> : null}
    <div className="signup-custom-services">
      <div className="signup-custom-heading"><div><h3>Não encontrou seu serviço?</h3><p>Adicione até 10 serviços próprios em qualquer área escolhida. Eles também poderão ser agendados pelas clientes.</p></div>
        <button className="btn btn-secondary" type="button" onClick={onAddCustom} disabled={customServices.length >= 10}><Plus size={14} /> Adicionar</button></div>
      {customServices.length ? <div className="signup-custom-list">{customServices.map((item, index) => <div className="signup-custom-row" key={index}>
        <label>Área<select value={item.category} onChange={event => onUpdateCustom(index, { category: event.target.value as Specialty })}>{areas.map(area => <option key={area} value={area}>{specialties[area]}</option>)}</select></label>
        <label>Nome do serviço<input value={item.name} onChange={event => onUpdateCustom(index, { name: event.target.value })} maxLength={100} placeholder="Ex.: penteado especial" /></label>
        <label>Preço (R$)<input type="number" min="0" max="1000000" step="0.01" value={item.price} onChange={event => onUpdateCustom(index, { price: event.target.value })} placeholder="0,00" /></label>
        <label>Duração (min)<input type="number" min="15" max="480" step="1" value={item.durationMinutes} onChange={event => onUpdateCustom(index, { durationMinutes: event.target.value })} /></label>
        <button className="signup-custom-remove" type="button" aria-label={`Remover serviço ${index + 1}`} onClick={() => onRemoveCustom(index)}><Trash2 size={17} /></button>
      </div>)}</div> : <p className="signup-services-custom">Você pode acrescentar serviços próprios agora ou depois em <strong>Seus serviços</strong>.</p>}
    </div>
  </section>
}

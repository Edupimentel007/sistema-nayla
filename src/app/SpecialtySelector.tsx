import { Check } from 'lucide-react'
import type { Specialty } from '../lib/api'
import { specialties, specialtyGroups } from './shared'
import './specialty-selector.css'

type Props = {
  selected: Specialty[]
  onToggle: (specialty: Specialty) => void
  legend?: string
  hint?: string
}

export function SpecialtySelector({ selected, onToggle, legend = 'Em quais áreas você atua?', hint }: Props) {
  return <fieldset className="specialty-field specialty-picker">
    <legend>{legend}</legend>
    <p className="specialty-intro">Escolha uma ou mais áreas. As clientes só poderão agendar serviços que você oferecer.</p>
    <div className="specialty-groups">{specialtyGroups.map(group => <div className="specialty-group" key={group.title}>
      <h3>{group.title}</h3>
      <div className="specialty-options">{group.items.map(item => <button key={item} type="button"
        className={`specialty-choice ${selected.includes(item) ? 'selected' : ''}`}
        aria-pressed={selected.includes(item)} onClick={() => onToggle(item)}>
        {selected.includes(item) ? <Check size={15} aria-hidden="true" /> : <span className="choice-circle" aria-hidden="true" />}
        {specialties[item]}
      </button>)}</div>
    </div>)}</div>
    <small className="specialty-note">{selected.length} {selected.length === 1 ? 'área selecionada' : 'áreas selecionadas'}. {hint || 'Não encontrou sua área? Escolha “Outra especialidade” e cadastre seus serviços depois.'}</small>
  </fieldset>
}

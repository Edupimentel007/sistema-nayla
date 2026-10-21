import { db } from './db.js';

// A hosted model only needs stable references to clients for one answer. Keep
// their real names on our server and replace references before building prompts.
export function createExternalAssistantPrivacy(businessId: string, businessName: string,
  businessSlug = '') {
  const names = (db.prepare(`SELECT DISTINCT name FROM users
    WHERE business_id=? AND role='client' ORDER BY name`).all(businessId) as { name: string }[])
    .map(row => row.name.trim()).filter(Boolean);
  const aliases = new Map<string, string>();
  const originals = new Map<string, string>();
  for (const name of names) {
    const alias = `NAYLA_CLIENTE_${aliases.size + 1}`;
    aliases.set(name, alias);
    originals.set(alias, name);
  }

  const normalize = (value: string) => value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const byTokens = names.map(name => ({
    name, tokens: name.match(/[\p{L}\p{M}]+/gu)?.map(normalize) || [],
  })).sort((a, b) => b.tokens.length - a.tokens.length || b.name.length - a.name.length);
  const byFirstToken = new Map<string, typeof byTokens>();
  for (const item of byTokens) {
    const first = item.tokens[0];
    if (!first) continue;
    const candidates = byFirstToken.get(first) || [];
    candidates.push(item);
    byFirstToken.set(first, candidates);
  }
  const firstNames = new Map<string, string | null>();
  for (const item of byTokens) {
    const first = item.tokens[0];
    if (first?.length < 3) continue;
    firstNames.set(first, firstNames.has(first) ? null : item.name);
  }

  function replaceKnownClients(value: string) {
    const words = [...value.matchAll(/[\p{L}\p{M}]+/gu)];
    if (!words.length) return value;
    let result = '';
    let cursor = 0;
    for (let i = 0; i < words.length;) {
      let matched: { name: string; count: number } | null = null;
      for (const candidate of byFirstToken.get(normalize(words[i][0])) || []) {
        const count = candidate.tokens.length;
        if (!count || i + count > words.length) continue;
        if (!candidate.tokens.every((token, index) =>
          normalize(words[i + index][0]) === token
          && (!index || /^[\s.'’-]+$/.test(value.slice(
            words[i + index - 1].index! + words[i + index - 1][0].length,
            words[i + index].index!))))) continue;
        matched = { name: candidate.name, count };
        break;
      }
      if (!matched) {
        const firstName = firstNames.get(normalize(words[i][0]));
        if (firstName) matched = { name: firstName, count: 1 };
      }
      if (!matched) { i++; continue; }
      const start = words[i].index!;
      const last = words[i + matched.count - 1];
      result += value.slice(cursor, start) + aliases.get(matched.name);
      cursor = last.index! + last[0].length;
      i += matched.count;
    }
    return result + value.slice(cursor);
  }

  function redactText(value: string) {
    let safe = value;
    if (businessName.trim()) safe = safe.replace(new RegExp(
      businessName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'MEU_ESPACO');
    if (businessSlug.trim()) safe = safe.replaceAll(`/agendar/${businessSlug.trim()}`,
      'NAYLA_LINK_AGENDAMENTO');
    safe = replaceKnownClients(safe);
    return safe
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail oculto]')
      .replace(/\b\d{2}[.]?\d{3}[.]?\d{3}[/]?\d{4}[-]?\d{2}\b/g, '[CNPJ oculto]')
      .replace(/\b\d{3}[.]?\d{3}[.]?\d{3}[-]?\d{2}\b/g, '[CPF oculto]')
      .replace(/(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}(?!\d)/g,
        '[telefone oculto]')
      .replace(/\b(?:\d[\s-]?){13,19}\b/g, '[cartão oculto]')
      .replace(/\b(?:gsk_|sk-|APP_USR-|TEST-)[a-z0-9_-]{8,}\b/gi, '[token oculto]')
      .replace(/\beyJ[a-z0-9_-]{20,}(?:\.[a-z0-9_-]{10,}){1,2}\b/gi, '[token oculto]')
      .replace(/\b(?:senha|password|token|secret|access[_ -]?token|api[_ -]?key)\s*[:=]\s*\S+/gi,
        '[credencial oculta]');
  }

  function aliasClient(value: string) {
    const entry = [...aliases.entries()].find(([name]) => normalize(name) === normalize(value));
    return entry?.[1] || redactText(value);
  }

  function originalClient(value: string) {
    const exact = originals.get(value.trim().toUpperCase());
    return exact || value;
  }

  function restoreAnswer(value: string) {
    return value.replace(/NAYLA_CLIENTE_\d+/gi, match =>
      originals.get(match.toUpperCase()) || 'uma cliente')
      .replace(/NAYLA_LINK_AGENDAMENTO/gi,
        businessSlug ? `/agendar/${businessSlug}` : 'seu link em Configurações');
  }

  return { redactText, aliasClient, originalClient, restoreAnswer };
}

export type ExternalAssistantPrivacy = ReturnType<typeof createExternalAssistantPrivacy>;

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { researchExternalAdvice } from './assistantExternalResearch.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const article = `<!doctype html><html><head>
  <meta name="description" content="Planeje um atendimento personalizado, mostre o resultado dos serviços e peça retorno às clientes.">
  </head><body><article><p>Para destacar seu trabalho, crie um portfólio de resultados com autorização e melhore a experiência de atendimento das clientes.</p></article></body></html>`;

test('consulta apenas termos genéricos e links permitidos, sem dados da conversa', async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/wp-json/')) return new Response(JSON.stringify([
      { title: { rendered: 'Como se diferenciar' },
        excerpt: { rendered: 'Ofereça uma experiência pessoal e fácil de agendar.' },
        link: 'http://127.0.0.1/private', date: '2026-01-01' },
      { title: { rendered: 'Proposta de valor para pequenas empresas' },
        excerpt: { rendered: 'Defina o público que deseja atender e descreva o valor do seu serviço de forma objetiva.' },
        link: 'https://blog.rn.sebrae.com.br/proposta-de-valor/', date: '2026-01-01' },
    ]), { headers: { 'content-type': 'application/json' } });
    return new Response(article, { headers: { 'content-type': 'text/html' } });
  };
  const result = await researchExternalAdvice(
    'Como me destacar? Cliente Ana Silva, CPF 123.456.789-00, faturamento R$ 99.999',
    ['unhas', 'http://127.0.0.1/admin', 'Cliente Beatriz'],
    { fetchImpl, cache: false },
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 3);
  assert.ok(result.sources.every(source => source.url.startsWith('https://')));
  assert.ok(result.sources.every(source => source.excerpt!.split(/\s+/).length <= 24));
  assert.ok(result.sources.some(source => source.url.endsWith('/proposta-de-valor/')));
  assert.ok(requests.some(url => url.endsWith('/proposta-de-valor/')));
  assert.ok(requests.every(url => !/Ana|Beatriz|123\.456|99\.999|127\.0\.0\.1/.test(url)));
  assert.ok(requests.every(url => new URL(url).hostname !== '127.0.0.1'));
});

test('fonte de estética facial não é atribuída a bronzeamento ou podologia', async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    seen.push(String(input));
    return String(input).includes('/wp-json/')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response(article, { headers: { 'content-type': 'text/html' } });
  };
  await researchExternalAdvice('Como me destacar?', ['bronzeamento', 'podologia'], {
    fetchImpl, cache: false,
  });
  assert.ok(!seen.some(url => url.includes('estetica-facial-como-se-destacar')));
  seen.length = 0;
  await researchExternalAdvice('Como me destacar?', ['estetica_facial'], {
    fetchImpl, cache: false,
  });
  assert.ok(seen.some(url => url.includes('estetica-facial-como-se-destacar')));
});

test('rede indisponível não produz fontes falsas', async () => {
  const result = await researchExternalAdvice('Me dê ideias para atrair clientes', ['sobrancelhas'], {
    fetchImpl: async () => { throw new Error('offline'); }, cache: false,
  });
  assert.deepEqual(result, { status: 'unavailable', summary: '', sources: [] });
});

test('retorna no_results se fontes respondem mas não contêm conteúdo útil', async () => {
  const result = await researchExternalAdvice('Quero cobrar melhor', ['unhas'], {
    fetchImpl: async input => String(input).includes('/wp-json/')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response('<html><p>Oi.</p></html>', { headers: { 'content-type': 'text/html' } }),
    cache: false,
  });
  assert.deepEqual(result, { status: 'no_results', summary: '', sources: [] });
});

test('interrompe rapidamente uma fonte travada', async () => {
  const began = performance.now();
  const fetchImpl: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const result = await researchExternalAdvice('Novas tendências', ['cilios'], {
    fetchImpl, timeoutMs: 100, cache: false,
  });
  assert.equal(result.status, 'unavailable');
  assert.ok(performance.now() - began < 1000);
});

test('deduplica consultas simultâneas e guarda só resultados públicos', async () => {
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return String(input).includes('/wp-json/')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response(article, { headers: { 'content-type': 'text/html' } });
  };
  const [first, second] = await Promise.all([
    researchExternalAdvice('Como melhorar a segurança do meu estúdio?', ['depilacao']),
    researchExternalAdvice('Como melhorar a segurança do meu estúdio?', ['depilacao']),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 3);
  await researchExternalAdvice('Como melhorar a segurança do meu estúdio?', ['depilacao']);
  assert.equal(calls, 3);
});

# Publicar a Nayla na Vercel

## Arquitetura necessária

A Vercel entrega somente a interface Vite/PWA. A API Express, o SQLite, o processamento de lembretes e o Ollama precisam rodar em um servidor persistente com HTTPS, disco e backup. A configuração em `vercel.mjs` encaminha `/api/*` para esse servidor e abre as páginas internas da SPA. A origem da API é lida na implantação; não há URL de produção fixa no código.

## Se o orçamento inicial for zero

- **Vercel Hobby não atende à oferta atual.** A Nayla apresenta planos e prevê cobranças. A [regra oficial da Vercel](https://vercel.com/docs/limits/fair-use-guidelines) classifica anúncio de venda e processamento de pagamentos como uso comercial, que requer Pro ou Enterprise, mesmo com a API em outro servidor. Colocar somente a interface na Vercel Hobby não muda essa regra.
- **Teste privado temporário:** execute o app no seu computador ou em um servidor que você já tenha, com contas fictícias e pagamentos reais desativados. Na mesma rede, web e celular podem acessar a API pelo endereço local; para instalar a PWA no iPhone fora do próprio aparelho, será necessário HTTPS confiável. Esse teste depende do computador ligado e não substitui hospedagem e backup para clientes reais. Um teste na Vercel só deve usar um plano compatível com o conteúdo comercial mostrado.
- **Alternativa experimental:** uma VM Arm OCI Ampere A1 marcada *Always Free* pode, se estiver disponível, hospedar **interface, API, SQLite em volume persistente, rotina de lembretes e Ollama na mesma máquina**, sem Vercel Hobby. É uma possibilidade técnica a validar, não uma garantia de desempenho ou operação comercial: a [Oracle informa limites e possível falta de capacidade](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), além de possível retomada de instâncias ociosas. Confira o suporte Arm de `better-sqlite3`, `sharp` e do modelo Ollama escolhido, faça backup externo e meça se a IA responde em até 30 segundos sob carga real. Não pressuponha disponibilidade contínua nem um SLA suficiente para clientes. No [cadastro Oracle](https://docs.oracle.com/pt-br/iaas/Content/FreeTier/freetier.htm), a maioria das pessoas precisa de telefone e cartão para verificação; o cartão não é debitado sem upgrade, segundo a Oracle. Domínio e serviços externos, como mensagens Meta e pagamentos, ainda podem ter custos.

## Preparação

1. Publique primeiro a API em um domínio próprio HTTPS, por exemplo `https://api.seudominio.com`. Configure no servidor `NODE_ENV=production`, `DATABASE_PATH` em disco persistente, Ollama local e backup. `/api/health` deve responder `{"ok":true}`. O banco local do computador **não é migrado automaticamente**.
2. Importe este repositório como projeto **Vite** na Vercel, com raiz do projeto no repositório. Defina a variável de ambiente `NAYLA_API_ORIGIN` com a origem HTTPS da API, sem caminho ou barra final. O build falha se ela faltar ou for inválida. O projeto usa `npm run build` e publica `dist`.
3. Use um domínio web estável para a PWA, por exemplo `https://app.seudominio.com`, e defina `APP_ORIGIN` da API com essa origem exata. O navegador usa `/api` na mesma origem; a Vercel encaminha para a API. Não configure os tokens do Mercado Pago, Google ou Meta no projeto Vercel da interface. Eles ficam somente no servidor da API.
4. Mantenha Preview isolado dos dados de produção. Para testar escrita num Preview, use uma API e banco de homologação e um domínio web de homologação estável correspondente ao `APP_ORIGIN` desse ambiente. Proteja os Previews; não aponte builds de teste para a API real.

## Teste antes de convidar clientes

- Abra `/`, `/entrar`, `/app` e `/agendar/SEU-LINK` pelo domínio web, inclusive por acesso direto e atualização da página.
- Confirme `https://app.seudominio.com/api/health`, depois cadastre uma profissional de teste, cadastre uma cliente e agende, altere e cancele um horário. Confira que agenda, financeiro e histórico permanecem após reiniciar a API.
- Teste a Nayla, a logo, as notificações e os lembretes agendados no servidor. Sem Ollama ativo, o chat livre não funciona; sem WhatsApp Cloud API de cada profissional, mensagens automáticas pelo WhatsApp não são enviadas.
- No iPhone, abra a PWA no Safari e use **Compartilhar → Adicionar à Tela de Início**. A Vercel não cria o aplicativo iOS da App Store. Avisos do dispositivo com a PWA fechada ainda dependem de uma implementação futura de push remoto.
- Para cobrança real, configure a aplicação Mercado Pago e o webhook em `https://app.seudominio.com/api/billing/webhooks/mercado-pago`, com `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` apenas no servidor da API. Faça os testes descritos em [MERCADO_PAGO_SETUP.md](MERCADO_PAGO_SETUP.md) antes de cobrar. O banco recebedor é configurado dentro da conta Mercado Pago, não na Nayla.

Antes de abrir a terceiros, publique a política de privacidade, prepare atendimento a solicitações sobre dados pessoais e use um plano Vercel permitido para operação comercial. O plano Hobby se limita a uso pessoal não comercial. Consulte a [configuração programática](https://vercel.com/docs/project-configuration/vercel-ts), as [rotas externas](https://vercel.com/docs/routing/rewrites), a [SPA Vite](https://vercel.com/docs/frameworks/frontend/vite) e as [regras de uso comercial](https://vercel.com/docs/limits/fair-use-guidelines).

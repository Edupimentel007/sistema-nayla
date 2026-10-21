# Nayla — aplicativo de agenda e gestão

Aplicativo de agenda, CRM e financeiro para profissionais de beleza e estética não cirúrgica, com acesso pela web e instalação no celular. Inclui unhas, sobrancelhas, cílios, cabelos, maquiagem, depilação, cuidados faciais e corporais, massagens, micropigmentação, bronzeamento, podologia e outras áreas. Cada empreendedora cria sua conta, escolhe os serviços que oferece e recebe um link de agendamento próprio. As clientes veem apenas os serviços ativos daquela profissional e acompanham seus horários em uma área separada.

## Funcionalidades

- Cadastro e login da empreendedora com escolha de áreas e serviços específicos, inclusive serviços próprios quando não estiverem na lista. Apenas os serviços escolhidos começam ativos; preços e durações dos modelos são sugestões editáveis. Novas áreas adicionadas depois entram com serviços desativados até a profissional escolhê-los.
- Link público `/agendar/SEU-LINK` com serviços, horários disponíveis e cadastro/login da cliente.
- Agenda com prevenção de conflito de horários, confirmação, conclusão, cancelamento e ausência. A cliente pode alterar seu serviço, dia e horário ou cancelar antes do atendimento; a agenda da profissional se atualiza automaticamente.
- Visão de clientes do dia com serviços, horários e situação de cada atendimento.
- CRM com dados das clientes e histórico de visitas.
- Visão geral com Hoje como período inicial e filtros de 7, 30, 60 e 90 dias, faturamento, ticket médio, agendamentos e clientes recorrentes.
- Análises com gráficos diários exploráveis, valores por dia, totais e picos, comparativos entre períodos, visitas de clientes, retorno, serviços e agenda; cada indicador traz explicação e dica prática. A assistente Nayla também responde sobre esses dados.
- Logo opcional no cadastro, editável nas Configurações, exibida no perfil, painel e página de agendamento.
- Financeiro com entradas automáticas dos atendimentos concluídos e lançamentos manuais de receitas e despesas. Oferece filtro Hoje, últimos 7, 30, 60 e 90 dias e próximos 30 dias. Lançamentos futuros aparecem no dia informado. Para pagamento recebido hoje por um atendimento futuro, use a data de hoje e vincule o agendamento; na conclusão, apenas o valor restante será lançado.
- Assistente Nayla para consultas aos dados da própria empreendedora e pedidos guiados de remarcação ou cancelamento, com revisão e confirmação pela profissional antes da alteração.
- Atalho flutuante da Nayla nas telas móveis do app da profissional, com acesso direto ao chat e retorno à tela anterior.
- Confirmações de agendamento com prévia local, histórico de status e integração opcional à WhatsApp Cloud API da Meta.
- Interface em português, responsiva, com temas claro e escuro.

## Rodar localmente

Requer Node.js 20.19+ (24 recomendado). Na pasta do projeto:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Abra `http://localhost:3001`. O comando `dev` compila a interface, acompanha alterações nos arquivos e inicia a API que serve a aplicação. Recarregue o navegador após mudanças na interface. O banco SQLite é criado automaticamente no caminho definido em `DATABASE_PATH`.

Links locais:

| Área | Link |
| --- | --- |
| Início | `http://localhost:3001/` |
| Cadastro da empreendedora | `http://localhost:3001/cadastro` |
| Login da empreendedora | `http://localhost:3001/entrar` |
| Apresentação e planos | `http://localhost:3001/app/boas-vindas` |
| Painel | `http://localhost:3001/app` |
| Financeiro | `http://localhost:3001/app/financeiro` |
| Assistente Nayla | `http://localhost:3001/app/assistente` |
| Análises | `http://localhost:3001/app/analises` |
| Configurações e confirmações | `http://localhost:3001/app/configuracoes` |
| Agendamento da cliente | `http://localhost:3001/agendar/SEU-LINK` |
| Login da cliente | `http://localhost:3001/agendar/SEU-LINK/entrar` |
| Área da cliente | `http://localhost:3001/agendar/SEU-LINK/meus-agendamentos` |

`SEU-LINK` é o identificador criado no cadastro da empreendedora. O link pronto para compartilhar aparece em **Configurações**. Para testar em um celular na mesma rede Wi-Fi, use o IP local do computador no lugar de `localhost` e libere a porta 3001 no firewall, se necessário. A instalação da PWA em outros dispositivos exige HTTPS; `localhost` é aceito somente no próprio dispositivo.

```powershell
npm.cmd run build
npm.cmd test
```

## App para celular

A Nayla funciona como **PWA instalável**: em um navegador compatível, use **Instalar app** ou a opção de adicionar à tela inicial. O app abre em janela própria, com ícone e tema. Agendamentos, CRM, financeiro e assistente precisam de conexão com a API; o cache guarda apenas arquivos da interface, sem guardar CPF, agenda ou dados financeiros.

O repositório também contém projetos **Android** e **iOS** com Capacitor. Eles são a base do pacote das lojas e usam os arquivos locais da interface; a API deve estar hospedada em HTTPS. Antes de sincronizar, defina `VITE_API_ORIGIN` com a origem pública da API, por exemplo `https://api.seu-dominio.com` (sem barra final), e `VITE_PUBLIC_APP_ORIGIN` com a origem pública do app web para os links compartilhados. Se ambos usam o mesmo domínio, a segunda pode ficar vazia. Execute:

```powershell
npm.cmd run mobile:sync
npm.cmd run mobile:android
```

O comando `mobile:ios` abre o projeto iOS em um Mac com Xcode. Para gerar um Android App Bundle e testar no emulador ou dispositivo, instale Android Studio e o SDK Android. Para compilar/assinar iOS, use macOS e Xcode. O `appId` provisório é `com.edupimentel.nayla` em `capacitor.config.ts`; defina o identificador definitivo antes de cadastrar o app nas lojas.

Para regenerar os ícones do app a partir de `assets/brand/nayla-icon-source.png`, execute `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1 -Force` e depois `npm.cmd run mobile:sync`.

**Publicação nas lojas:** crie contas de desenvolvedor, configure assinatura e dados da loja, publique a API, faça testes em dispositivos e envie os pacotes para análise. A [Google Play cobra US$ 25 uma vez](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en); o [Apple Developer Program custa US$ 99 por ano](https://developer.apple.com/programs/whats-included/), ou valor local equivalente no cadastro. Contas pessoais novas no Google Play precisam de [teste fechado com pelo menos 12 pessoas durante 14 dias](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB). A [Apple exige utilidade de app além de uma página empacotada](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality); a aprovação depende da análise da loja. O projeto nativo ainda precisa ser compilado e testado nos SDKs oficiais antes de submissão. Hospedagem, domínio e capacidade de processamento para a IA local podem gerar custos à parte.

## Configuração opcional

### Assistente com IA

A Nayla usa um **modelo aberto executado no servidor com Ollama**. Não há cobrança por chamada a uma API de IA. O modelo recebe, a cada pergunta, guias escritos para todas as áreas de beleza do catálogo e para as telas do app, além de ferramentas de consulta aos dados atuais da profissional. Isso contextualiza as respostas; **não é um ajuste dos pesos nem um treinamento novo do modelo**. Para ativar:

1. [Instale o Ollama](https://docs.ollama.com/quickstart) no computador ou servidor que executa a API Nayla. No Windows, abra o instalador oficial e confirme que o Ollama está em execução. Em um Linux sem aplicativo gráfico, inicie o serviço conforme a documentação oficial.
2. Nesse servidor, execute `ollama pull qwen3:8b`. O modelo ocupa cerca de **5,2 GB de download** e precisa de memória adicional para rodar. Para conferir: `ollama list` deve mostrar `qwen3:8b` e `http://127.0.0.1:11434/api/tags` deve responder no próprio servidor.
3. Copie `.env.example` para `.env` e mantenha `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1` e `OLLAMA_MODEL=qwen3:8b`. Reinicie a API Nayla. No Windows, pode testar a resposta do servidor com `Invoke-RestMethod http://127.0.0.1:11434/api/tags` no PowerShell.

Em um computador com **8 GB de RAM** e GPU incompatível com o Ollama, use o modelo menor pela CPU: `ollama pull qwen3:4b-instruct` e `ollama create nayla-qwen3:4b-cpu -f ollama/Modelfile.qwen3-4b-cpu`. Configure `OLLAMA_MODEL=nayla-qwen3:4b-cpu` no `.env` e reinicie a API. O perfil mantém o modelo de 4B com contexto de 4.096 tokens para gastar menos memória. Perguntas objetivas sobre agenda, faturamento e melhorias do negócio são respondidas diretamente dos dados, sem carregar o modelo; perguntas abertas continuam no chat livre. A geração pelo modelo tem limite de 24 segundos; se exceder, a Nayla responde com os dados e orientações disponíveis, sem aguardar indefinidamente. Para liberar RAM após a conversa, configure `OLLAMA_KEEP_ALIVE=1m` e `OLLAMA_MAX_LOADED_MODELS=1` no ambiente do processo Ollama e reinicie-o. [Veja os parâmetros oficiais do Ollama](https://docs.ollama.com/faq). A primeira resposta aberta após o modelo ser descarregado pode atingir esse limite neste computador; para uso por várias profissionais, dimensione o servidor conforme a carga real.

O modelo e a API Nayla precisam estar **no mesmo servidor**; o app web ou mobile acessa a API autenticada e não precisa instalar o modelo no celular. A Nayla aceita somente uma conexão Ollama em `localhost` ou `127.0.0.1`; não exponha a porta 11434 à internet. Para impedir recursos de nuvem do Ollama, configure `OLLAMA_NO_CLOUD=1` e `OLLAMA_HOST=127.0.0.1:11434` no ambiente do processo e reinicie o Ollama; [a documentação oficial explica a configuração no Windows](https://docs.ollama.com/faq). A API verifica se o serviço está acessível e se o modelo foi baixado antes de anunciar a IA como disponível. Sem Ollama ativo, consultas básicas locais continuam funcionando, mas respostas abertas de IA ficam indisponíveis. A hospedagem do servidor e sua capacidade de memória/processamento ainda podem ter custo; não há garantia de custo zero de infraestrutura nem de qualidade idêntica a serviços de IA maiores. [API local e compatibilidade](https://docs.ollama.com/api/openai-compatibility), [modelo Qwen3 8B](https://ollama.com/library/qwen3:8b).

As perguntas são respondidas com o contexto atualizado do negócio autenticado. As conversas ficam salvas no banco do servidor para a profissional abrir, continuar ou apagar depois; ao modelo são enviadas somente as oito mensagens recentes, com tamanho limitado. O acesso ao histórico exige a sessão da mesma profissional e do mesmo espaço, inclusive em outro dispositivo conectado ao mesmo servidor. Conversas podem conter dados comerciais e pessoais digitados pela usuária: restrinja o acesso ao banco e aos backups, inclua esse conteúdo na política de retenção e evite escrever CPF, senhas ou dados de cartão no chat. Fatos sobre faturamento, clientes e agenda vêm apenas do banco; orientações por área são ligadas às especialidades cadastradas. Alterações de agendamento continuam exigindo revisão e confirmação pela profissional.

Ao pedir dicas de negócio, diferenciação ou tendências, a Nayla combina os indicadores do espaço e os serviços cadastrados com uma consulta rápida a páginas públicas selecionadas do Sebrae, Google e Anvisa. O servidor pesquisa somente o **tema genérico e a área**, sem enviar a pergunta completa, nome do negócio, clientes ou valores financeiros. As fontes realmente acessadas aparecem como links na resposta e no histórico. A consulta usa endpoints públicos sem chave nem cobrança por chamada, tem limite de 4,8 segundos e cache curto; ela não é uma busca irrestrita na internet. Quando as páginas estão indisponíveis ou não são pertinentes, a Nayla informa que suas dicas usam apenas os dados locais e não inventa uma tendência. Para desativar a consulta externa, defina `NAYLA_EXTERNAL_RESEARCH=off` no ambiente do servidor. Em redes Windows que usam certificado TLS do sistema, inicie o Node com `NODE_USE_SYSTEM_CA=1`; não desative a verificação TLS.

### Entrada com Google e segurança da sessão

O cadastro com e-mail e senha está disponível para profissionais e clientes. A Nayla orienta criar senhas com **12 ou mais caracteres, letras e números**. No primeiro agendamento, a cliente informa nome, CPF e telefone. A opção **Manter conectado** conserva o acesso neste dispositivo por até **7 dias**; sem ela, a sessão do servidor expira em 24 horas. Depois da validade, é preciso entrar novamente. Contas existentes preservam suas senhas; sessões antigas também são limitadas a sete dias na próxima inicialização.

Para ativar o botão **Continuar com Google**, crie no [Google Cloud Console](https://console.cloud.google.com/apis/credentials) um cliente OAuth 2.0 do tipo **Aplicativo da Web** e configure no `.env` do servidor `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Cadastre como URI de redirecionamento exatamente `APP_ORIGIN/api/auth/google/callback`. `APP_ORIGIN` pode ser `http://localhost:3001` para testes no próprio computador; em produção deve ser a origem pública HTTPS da Nayla. Não coloque o segredo em `VITE_` nem no app instalado. Sem as credenciais, o botão fica oculto e o acesso com senha segue funcionando.

O Google retorna à API, que valida estado, PKCE, assinatura, emissor, público, validade e nonce do token. O vínculo usa o identificador estável da conta Google. Se um e-mail já tem conta Nayla, a pessoa confirma a senha existente antes de conectar o Google. No primeiro acesso da profissional, ela escolhe nome do espaço, link, áreas e serviços oferecidos e uma senha de recuperação. No primeiro acesso da cliente, ela informa CPF, telefone e senha no espaço daquela profissional. Uma conta de cliente não dá acesso à agenda de outra profissional.

Nos aplicativos Android e iOS, a autenticação abre o navegador seguro do sistema e retorna pelo link `com.edupimentel.nayla://auth`; o código de uso único só pode ser trocado pela instância do app que iniciou a operação. O retorno requer a API HTTPS configurada em `VITE_API_ORIGIN`, a sincronização Capacitor e teste real em cada plataforma. O cliente OAuth do Google continua sendo do tipo **Aplicativo da Web**, pois o redirecionamento registrado aponta para a API HTTPS.

### Planos e pagamentos Mercado Pago

Siga o [passo a passo de configuração do Mercado Pago](MERCADO_PAGO_SETUP.md) para ligar sua conta recebedora sem expor tokens ou dados bancários.

No primeiro acesso, a profissional conhece os recursos e vê os planos **mensal de R$ 49,90** e **anual de até 12 cobranças mensais de R$ 35**. Depois do teste grátis, o cartão usa a [API de Assinaturas do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview): o mensal cobra **R$ 49,90 automaticamente a cada mês até cancelar**; o anual faz até **12 cobranças mensais automáticas de R$ 35**, somando R$ 420 somente se todas ocorrerem. Não é parcelamento de uma compra única na fatura. Cada pagamento aprovado libera somente o período correspondente à fatura. A profissional pode cancelar próximas cobranças na tela de planos; conserva o acesso até o fim do período já pago. O cartão é informado apenas no ambiente do Mercado Pago; a Nayla não recebe número nem CVV.

O **Pix é avulso**: R$ 49,90 por um mês ou R$ 420 por um ano, com QR dinâmico e código copia e cola. O Pix não cria assinatura nem renovação automática. A interface explica o valor e a recorrência antes de abrir o checkout.

Para conectar a conta recebedora, [crie uma aplicação Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-application), obtenha o **Access Token** de teste e depois o de produção, e configure a URL pública `https://SEU-DOMINIO/api/billing/webhooks/mercado-pago` para os eventos de pagamento e assinatura disponibilizados na sua aplicação. Coloque `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` somente nas variáveis protegidas do servidor. Configure o banco/recebimento dentro da conta Mercado Pago, nunca no código nem no chat. `APP_ORIGIN` deve ser a origem pública HTTPS da Nayla. O backend cria os modelos mensal e anual no Mercado Pago, valida os valores e associa cada assinatura à profissional. Acesso pago é concedido apenas após consultar uma fatura e seu pagamento aprovado diretamente na API; status `authorized` e retorno do navegador não bastam. A página de Assinaturas do Mercado Pago traz orientações conflitantes sobre como habilitar os tópicos de Webhook; antes de cobrança real, confirme no painel/suporte o recebimento e a assinatura dos eventos na sua aplicação e realize uma compra controlada. O app também concilia faturas ao consultar o estado da assinatura. Veja [Webhooks de Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks) e o [guia de configuração](MERCADO_PAGO_SETUP.md).

**Primeiro mês grátis:** a profissional pode iniciar **30 dias de teste sem cartão** na tela de boas-vindas. O prazo começa ao tocar em **Começar meus 30 dias grátis**, é registrado no servidor e não pode ser reiniciado. O teste não gera cobrança automática nem permite antecipar uma cobrança pelo checkout. Após o prazo, ela decide se quer contratar um plano. Acesso ao painel e ao link de agendamento é suspenso ao fim do teste até a confirmação de um pagamento. No ambiente local sem credenciais de pagamento, também existe acesso de demonstração, separado do prazo comercial.

Os pacotes Android e iOS mostram o estado da conta, mas **não oferecem checkout Mercado Pago dentro do app**. Para uma assinatura de recursos digitais, [Google Play](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en) e [App Store](https://developer.apple.com/app-store/review/guidelines/) têm regras próprias de cobrança e links externos. A compra pelo Mercado Pago fica na versão web; antes de enviar às lojas, confirme o modelo de distribuição e as exigências atuais de cada plataforma.

### Confirmação por WhatsApp

No ambiente local, `WHATSAPP_MODE=simulate` gera uma confirmação no histórico em **Configurações**, sem contato com a Meta ou envio ao telefone. O painel identifica essas mensagens como **simuladas**. A empreendedora pode abrir a conversa com o texto preparado e confirmar manualmente o envio no WhatsApp. O agendamento permanece disponível mesmo quando as mensagens estão desativadas.

Cada empreendedora preenche seu próprio número no painel. Para que as mensagens automáticas saiam desse número, ela precisa ter uma conta WhatsApp Business Platform, o número conectado à Cloud API e um modelo de mensagem de utilidade aprovado pela Meta. No painel, ela seleciona o modo Meta e informa o token de acesso, ID do número, segredo do aplicativo Meta e nome do modelo da própria integração. O servidor só permite salvar esses segredos quando `WHATSAPP_ENCRYPTION_KEY` contém uma chave aleatória de 32 bytes em base64. Gere uma chave para a instalação e guarde-a em segurança: perder ou trocar a chave impede ler as credenciais já salvas. O modelo `pt_BR` precisa ter **seis parâmetros de texto, nesta ordem**: nome da cliente, nome do espaço, serviço, dia da semana, data (DD/MM/AAAA) e horário. Texto sugerido:

```text
Olá, {{1}}! Seu agendamento com {{2}} para {{3}} está confirmado: {{4}}, {{5}}, às {{6}}. Até lá!
```

Para alterações e cancelamentos, cadastre também um **segundo modelo aprovado em `pt_BR`**, com quatro parâmetros: cliente, espaço, resumo da alteração e algumas opções de horário com link para a agenda pública quando `APP_ORIGIN` estiver configurado. O sistema identifica o mês e ano das opções. Texto sugerido:

```text
RESPONDER URGENTE
Olá, {{1}}! Atualização do seu agendamento com {{2}}: {{3}}
Disponibilidade: {{4}}
Responda com o motivo da alteração e, se precisar remarcar, o melhor horário para você.
```

Para lembretes, cadastre um **terceiro modelo aprovado em `pt_BR`** com sete parâmetros: cliente, espaço, serviço, dia da semana, data, horário e antecedência (`amanhã`, `hoje` ou `em 1 hora`). Texto sugerido:

```text
Olá, {{1}}! Lembrete: seu atendimento de {{3}} com {{2}} é {{7}}, {{4}}, {{5}} às {{6}}.
```

Os três nomes de modelo são configurados por empreendedora em **Configurações**. Confirme no painel da Meta que cada modelo foi aprovado e que seu texto corresponde ao exemplo: a Nayla registra uma prévia local, enquanto o envio real usa o corpo do modelo aprovado na Meta. Alterações da cliente e pedidos da profissional registram um aviso no histórico mesmo se o envio estiver desativado ou sem credenciais. Uma etiqueta nativa de conversa do WhatsApp Business não é aplicada por essa API; **RESPONDER URGENTE** aparece na prévia e no histórico da Nayla. As respostas das clientes devem ser acompanhadas na conta WhatsApp conectada; a Nayla ainda não recebe respostas pelo webhook nem remarca sozinha a partir delas.

A caixa de avisos do app mostra novos agendamentos, alterações e cancelamentos para a profissional e lembretes para a cliente. Os lembretes são preparados **24 horas antes**, **no dia às 07h no fuso de São Paulo** (ou duas horas antes quando o atendimento é cedo) e **1 hora antes**, sempre com serviço, data e horário. Um agendamento criado após um desses prazos não recebe o respectivo lembrete atrasado. A rotina roda a cada minuto enquanto a API está em execução, recupera pendências após reiniciar e registra cada prazo uma só vez. Horários expirados e lembretes de agendamentos alterados ou cancelados são descartados. O aviso do navegador depende de permissão e da página aberta; alertas do sistema operacional com o app fechado exigem a futura configuração de push remoto. O WhatsApp só é acionado quando a cliente autorizou, a profissional configurou a Cloud API e o terceiro modelo foi aprovado. Em uma interrupção durante a chamada à Meta, um envio de resultado incerto não é repetido automaticamente para evitar mensagens duplicadas.

A cliente escolhe receber mensagens pelo WhatsApp no formulário de agendamento. O sistema registra essa escolha e só tenta enviar para quem autorizou. O histórico diferencia uma mensagem **aceita pela Meta** de uma mensagem **enviada, entregue ou lida**; os últimos estados dependem do webhook da Meta. Cada empreendedora recebe no painel a URL e o token de verificação do seu webhook para cadastrar no aplicativo Meta dela. A URL precisa ser pública e HTTPS; `localhost` não é alcançável pela Meta. Em produção, sem configuração do negócio, as mensagens ficam desativadas.

O remetente do envio automático é o número Cloud API configurado por aquela empreendedora. A prévia local e o botão de abertura manual da conversa não fazem envio automático.

A [Meta cobra mensagens entregues pela Business Platform conforme o destino e a categoria](https://whatsappbusiness.com/products/platform-pricing/). O modo de simulação local não gera essas cobranças.

### Produção

Configure `NODE_ENV=production`, `APP_ORIGIN` com a origem pública HTTPS, `WHATSAPP_MODE=disabled` como modo inicial dos novos negócios e um `DATABASE_PATH` persistente. O SQLite atende à instalação local ou a uma instância única com disco persistente. Para operar em múltiplas instâncias ou infraestrutura sem disco persistente, será necessária a migração do banco para um serviço gerenciado. Faça backups regulares do banco e configure credenciais dos provedores somente no ambiente do servidor.

Para testar ou publicar a interface web e a PWA, siga o [guia de implantação na Vercel](DEPLOY_VERCEL.md). Ele mostra as dependências da API, os limites do plano gratuito e uma alternativa experimental sem mensalidade de hospedagem. A [preparação do banco para Turso](database/MIGRATION_TURSO.md) explica o backup e o trabalho necessário antes de executar a API sem VPS.

## Estrutura

- `src/`: interface React da empreendedora e da cliente.
- `server/`: API Express, autenticação, consultas, agenda, notificações e assistente.
- `database/schema.sql`: tabelas e índices SQLite.

Dados de clientes, inclusive CPF e telefone, devem ser tratados como dados pessoais. Restrinja o acesso ao banco e aos backups, defina uma política de retenção e publique uma política de privacidade antes de abrir o serviço ao público.

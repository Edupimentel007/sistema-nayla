# Nayla — aplicativo de agenda e gestão

Aplicativo de agenda, CRM e financeiro para profissionais de unhas, sobrancelhas e cílios, com acesso pela web e instalação no celular. Cada empreendedora cria sua conta e recebe um link de agendamento próprio. As clientes acessam a página daquela profissional, escolhem um serviço e acompanham seus horários em uma área separada.

## Funcionalidades

- Cadastro e login da empreendedora, com serviços iniciais conforme as especialidades escolhidas. Preços e durações são sugestões editáveis.
- Link público `/agendar/SEU-LINK` com serviços, horários disponíveis e cadastro/login da cliente.
- Agenda com prevenção de conflito de horários, confirmação, conclusão, cancelamento e ausência. A cliente pode alterar seu serviço, dia e horário ou cancelar antes do atendimento; a agenda da profissional se atualiza automaticamente.
- Visão de clientes do dia com serviços, horários e situação de cada atendimento.
- CRM com dados das clientes e histórico de visitas.
- Dashboard de 7, 30, 60 e 90 dias, faturamento, ticket médio, agendamentos e clientes recorrentes.
- Análises com gráficos de agenda, receita, clientes e ticket médio, explicações e dicas práticas para melhorar os resultados; a assistente Nayla também responde sobre esses indicadores.
- Personalização da página de agendamento e do painel com a logo enviada pela própria profissional.
- Financeiro com entradas automáticas dos atendimentos concluídos e lançamentos manuais de receitas e despesas.
- Assistente Nayla para consultas aos dados da própria empreendedora e pedidos guiados de remarcação ou cancelamento, com revisão e confirmação pela profissional antes da alteração.
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
| Painel | `http://localhost:3001/app` |
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

**Publicação nas lojas:** crie contas de desenvolvedor, configure assinatura e dados da loja, publique a API, faça testes em dispositivos e envie os pacotes para análise. A [Google Play cobra US$ 25 uma vez](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en); o [Apple Developer Program custa US$ 99 por ano](https://developer.apple.com/programs/whats-included/), ou valor local equivalente no cadastro. Contas pessoais novas no Google Play precisam de [teste fechado com pelo menos 12 pessoas durante 14 dias](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB). A [Apple exige utilidade de app além de uma página empacotada](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality); a aprovação depende da análise da loja. O projeto nativo ainda precisa ser compilado e testado nos SDKs oficiais antes de submissão. Hospedagem, domínio e uso opcional de IA podem gerar custos à parte.

## Configuração opcional

### Assistente com IA

Defina `OPENAI_API_KEY` e, se desejar, `OPENAI_MODEL` no `.env`. As consultas estruturadas à agenda e ao financeiro funcionam sem a chave; a chave habilita respostas em linguagem natural para perguntas adicionais. A API calcula os dados autorizados antes de enviá-los ao modelo e limita o contexto ao negócio da usuária autenticada.

### Entrada com Google e segurança da sessão

O cadastro com e-mail e senha está disponível para profissionais e clientes. A Nayla orienta criar senhas com **12 ou mais caracteres, letras e números**. No primeiro agendamento, a cliente informa nome, CPF e telefone. A opção **Manter conectado** conserva o acesso neste dispositivo por até **7 dias**; sem ela, a sessão do servidor expira em 24 horas. Depois da validade, é preciso entrar novamente. Contas existentes preservam suas senhas; sessões antigas também são limitadas a sete dias na próxima inicialização.

Para ativar o botão **Continuar com Google**, crie no [Google Cloud Console](https://console.cloud.google.com/apis/credentials) um cliente OAuth 2.0 do tipo **Aplicativo da Web** e configure no `.env` do servidor `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Cadastre como URI de redirecionamento exatamente `APP_ORIGIN/api/auth/google/callback`. `APP_ORIGIN` pode ser `http://localhost:3001` para testes no próprio computador; em produção deve ser a origem pública HTTPS da Nayla. Não coloque o segredo em `VITE_` nem no app instalado. Sem as credenciais, o botão fica oculto e o acesso com senha segue funcionando.

O Google retorna à API, que valida estado, PKCE, assinatura, emissor, público, validade e nonce do token. O vínculo usa o identificador estável da conta Google. Se um e-mail já tem conta Nayla, a pessoa confirma a senha existente antes de conectar o Google. No primeiro acesso da profissional, ela escolhe nome do espaço, link, áreas de atuação e uma senha de recuperação. No primeiro acesso da cliente, ela informa CPF, telefone e senha no espaço daquela profissional. Uma conta de cliente não dá acesso à agenda de outra profissional.

Nos aplicativos Android e iOS, a autenticação abre o navegador seguro do sistema e retorna pelo link `com.edupimentel.nayla://auth`; o código de uso único só pode ser trocado pela instância do app que iniciou a operação. O retorno requer a API HTTPS configurada em `VITE_API_ORIGIN`, a sincronização Capacitor e teste real em cada plataforma. O cliente OAuth do Google continua sendo do tipo **Aplicativo da Web**, pois o redirecionamento registrado aponta para a API HTTPS.

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

Os dois nomes de modelo são configurados por empreendedora em **Configurações**. Confirme no painel da Meta que cada modelo foi aprovado e que seu texto corresponde ao exemplo: a Nayla registra uma prévia local, enquanto o envio real usa o corpo do modelo aprovado na Meta. Alterações da cliente e pedidos da profissional registram um aviso no histórico mesmo se o envio estiver desativado ou sem credenciais. Uma etiqueta nativa de conversa do WhatsApp Business não é aplicada por essa API; **RESPONDER URGENTE** aparece na prévia e no histórico da Nayla. As respostas das clientes devem ser acompanhadas na conta WhatsApp conectada; a Nayla ainda não recebe respostas pelo webhook nem remarca sozinha a partir delas.

A cliente escolhe receber mensagens pelo WhatsApp no formulário de agendamento. O sistema registra essa escolha e só tenta enviar para quem autorizou. O histórico diferencia uma mensagem **aceita pela Meta** de uma mensagem **enviada, entregue ou lida**; os últimos estados dependem do webhook da Meta. Cada empreendedora recebe no painel a URL e o token de verificação do seu webhook para cadastrar no aplicativo Meta dela. A URL precisa ser pública e HTTPS; `localhost` não é alcançável pela Meta. Em produção, sem configuração do negócio, as mensagens ficam desativadas.

O remetente do envio automático é o número Cloud API configurado por aquela empreendedora. A prévia local e o botão de abertura manual da conversa não fazem envio automático.

A [Meta cobra mensagens entregues pela Business Platform conforme o destino e a categoria](https://whatsappbusiness.com/products/platform-pricing/). O modo de simulação local não gera essas cobranças.

### Produção

Configure `NODE_ENV=production`, `APP_ORIGIN` com a origem pública HTTPS, `WHATSAPP_MODE=disabled` como modo inicial dos novos negócios e um `DATABASE_PATH` persistente. O SQLite atende à instalação local ou a uma instância única com disco persistente. Para operar em múltiplas instâncias ou infraestrutura sem disco persistente, será necessária a migração do banco para um serviço gerenciado. Faça backups regulares do banco e configure credenciais dos provedores somente no ambiente do servidor.

## Estrutura

- `src/`: interface React da empreendedora e da cliente.
- `server/`: API Express, autenticação, consultas, agenda, notificações e assistente.
- `database/schema.sql`: tabelas e índices SQLite.

Dados de clientes, inclusive CPF e telefone, devem ser tratados como dados pessoais. Restrinja o acesso ao banco e aos backups, defina uma política de retenção e publique uma política de privacidade antes de abrir o serviço ao público.

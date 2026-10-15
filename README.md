# Nayla — aplicativo de agenda e gestão

Aplicativo de agenda, CRM e financeiro para profissionais de unhas, sobrancelhas e cílios, com acesso pela web e instalação no celular. Cada empreendedora cria sua conta e recebe um link de agendamento próprio. As clientes acessam a página daquela profissional, escolhem um serviço e acompanham seus horários em uma área separada.

## Funcionalidades

- Cadastro e login da empreendedora, com serviços iniciais conforme as especialidades escolhidas. Preços e durações são sugestões editáveis.
- Link público `/agendar/SEU-LINK` com serviços, horários disponíveis e cadastro/login da cliente.
- Agenda com prevenção de conflito de horários, confirmação, conclusão, cancelamento e ausência.
- CRM com dados das clientes e histórico de visitas.
- Dashboard de 7, 30, 60 e 90 dias, faturamento, ticket médio, agendamentos e clientes recorrentes.
- Financeiro com entradas automáticas dos atendimentos concluídos e lançamentos manuais de receitas e despesas.
- Assistente Nayla para consultas aos dados da própria empreendedora, com respostas adicionais por IA quando configurada.
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

**Publicação nas lojas:** crie contas de desenvolvedor, configure assinatura e dados da loja, publique a API, faça testes em dispositivos e envie os pacotes para análise. A [Google Play cobra US$ 25 uma vez](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en); o [Apple Developer Program custa US$ 99 por ano](https://developer.apple.com/programs/whats-included/), ou valor local equivalente no cadastro. Contas pessoais novas no Google Play precisam de [teste fechado com pelo menos 12 pessoas durante 14 dias](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB). A [Apple exige utilidade de app além de uma página empacotada](https://developer.apple.com/app-store/review/guidelines/uk/#minimum-functionality); a aprovação depende da análise da loja. O projeto nativo ainda precisa ser compilado e testado nos SDKs oficiais antes de submissão.

## Configuração opcional

### Assistente com IA

Defina `OPENAI_API_KEY` e, se desejar, `OPENAI_MODEL` no `.env`. As consultas estruturadas à agenda e ao financeiro funcionam sem a chave; a chave habilita respostas em linguagem natural para perguntas adicionais. A API calcula os dados autorizados antes de enviá-los ao modelo e limita o contexto ao negócio da usuária autenticada.

### Confirmação por WhatsApp

No ambiente local, `WHATSAPP_MODE=simulate` gera uma confirmação no histórico em **Configurações**, sem contato com a Meta ou envio ao telefone. O painel identifica essas mensagens como **simuladas**. A empreendedora pode abrir a conversa com o texto preparado e confirmar manualmente o envio no WhatsApp. O agendamento permanece disponível mesmo quando as mensagens estão desativadas.

Cada empreendedora preenche seu próprio número no painel. Para que as mensagens automáticas saiam desse número, ela precisa ter uma conta WhatsApp Business Platform, o número conectado à Cloud API e um modelo de mensagem de utilidade aprovado pela Meta. No painel, ela seleciona o modo Meta e informa o token de acesso, ID do número, segredo do aplicativo Meta e nome do modelo da própria integração. O servidor só permite salvar esses segredos quando `WHATSAPP_ENCRYPTION_KEY` contém uma chave aleatória de 32 bytes em base64. Gere uma chave para a instalação e guarde-a em segurança: perder ou trocar a chave impede ler as credenciais já salvas. O modelo `pt_BR` precisa ter **seis parâmetros de texto, nesta ordem**: nome da cliente, nome do espaço, serviço, dia da semana, data (DD/MM/AAAA) e horário. Texto sugerido:

```text
Olá, {{1}}! Seu agendamento com {{2}} para {{3}} está confirmado: {{4}}, {{5}}, às {{6}}. Até lá!
```

A cliente escolhe receber mensagens pelo WhatsApp no formulário de agendamento. O sistema registra essa escolha e só tenta enviar para quem autorizou. O histórico diferencia uma mensagem **aceita pela Meta** de uma mensagem **enviada, entregue ou lida**; os últimos estados dependem do webhook da Meta. Cada empreendedora recebe no painel a URL e o token de verificação do seu webhook para cadastrar no aplicativo Meta dela. A URL precisa ser pública e HTTPS; `localhost` não é alcançável pela Meta. Em produção, sem configuração do negócio, as mensagens ficam desativadas.

O remetente do envio automático é o número Cloud API configurado por aquela empreendedora. A prévia local e o botão de abertura manual da conversa não fazem envio automático.

### Produção

Configure `NODE_ENV=production`, `APP_ORIGIN` com a origem pública HTTPS e um `DATABASE_PATH` persistente. O SQLite atende à instalação local ou a uma instância única com disco persistente. Para operar em múltiplas instâncias ou infraestrutura sem disco persistente, será necessária a migração do banco para um serviço gerenciado. Faça backups regulares do banco e configure credenciais dos provedores somente no ambiente do servidor.

## Estrutura

- `src/`: interface React da empreendedora e da cliente.
- `server/`: API Express, autenticação, consultas, agenda, notificações e assistente.
- `database/schema.sql`: tabelas e índices SQLite.

Dados de clientes, inclusive CPF e telefone, devem ser tratados como dados pessoais. Restrinja o acesso ao banco e aos backups, defina uma política de retenção e publique uma política de privacidade antes de abrir o serviço ao público.

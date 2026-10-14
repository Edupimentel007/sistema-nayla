# Nayla

Sistema de agenda, CRM e financeiro para profissionais de unhas, sobrancelhas e cílios. Cada empreendedora cria sua conta e recebe um link de agendamento próprio. As clientes acessam a página daquela profissional, escolhem um serviço e acompanham seus horários em uma área separada.

## Funcionalidades

- Cadastro e login da empreendedora, com serviços iniciais conforme as especialidades escolhidas. Preços e durações são sugestões editáveis.
- Link público `/agendar/SEU-LINK` com serviços, horários disponíveis e cadastro/login da cliente.
- Agenda com prevenção de conflito de horários, confirmação, conclusão, cancelamento e ausência.
- CRM com dados das clientes e histórico de visitas.
- Dashboard de 7, 30, 60 e 90 dias, faturamento, ticket médio, agendamentos e clientes recorrentes.
- Financeiro com entradas automáticas dos atendimentos concluídos e lançamentos manuais de receitas e despesas.
- Assistente Nayla para consultas aos dados da própria empreendedora, com respostas adicionais por IA quando configurada.
- Confirmação de agendamento por WhatsApp Cloud API quando as credenciais e o template da Meta estiverem configurados. O status fica registrado no banco.
- Interface em português, responsiva, com temas claro e escuro.

## Rodar localmente

Requer Node.js 20.19+ (24 recomendado). Na pasta do projeto:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Abra `http://localhost:3001`. O comando `dev` compila a interface, acompanha alterações nos arquivos e inicia a API que serve a aplicação. Recarregue o navegador após mudanças na interface. O banco SQLite é criado automaticamente no caminho definido em `DATABASE_PATH`.

```powershell
npm.cmd run build
npm.cmd test
```

## Configuração opcional

### Assistente com IA

Defina `OPENAI_API_KEY` e, se desejar, `OPENAI_MODEL` no `.env`. As consultas estruturadas à agenda e ao financeiro funcionam sem a chave; a chave habilita respostas em linguagem natural para perguntas adicionais. A API calcula os dados autorizados antes de enviá-los ao modelo e limita o contexto ao negócio da usuária autenticada.

### Confirmação por WhatsApp

Configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_TEMPLATE_NAME`. O template aprovado na Meta deve ter, nessa ordem, cinco parâmetros de texto no corpo: **nome da cliente, serviço, dia da semana, data e horário**. Use o idioma `pt_BR`. Sem essa configuração, o agendamento continua funcionando e o envio fica registrado como `not_configured`.

### Produção

Configure `NODE_ENV=production`, `APP_ORIGIN` com a origem pública HTTPS e um `DATABASE_PATH` persistente. O SQLite atende à instalação local ou a uma instância única com disco persistente. Para operar em múltiplas instâncias ou infraestrutura sem disco persistente, será necessária a migração do banco para um serviço gerenciado. Faça backups regulares do banco e configure credenciais dos provedores somente no ambiente do servidor.

## Estrutura

- `src/`: interface React da empreendedora e da cliente.
- `server/`: API Express, autenticação, consultas, agenda, notificações e assistente.
- `database/schema.sql`: tabelas e índices SQLite.

Dados de clientes, inclusive CPF e telefone, devem ser tratados como dados pessoais. Restrinja o acesso ao banco e aos backups, defina uma política de retenção e publique uma política de privacidade antes de abrir o serviço ao público.

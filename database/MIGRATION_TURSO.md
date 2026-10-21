# Preparar o banco Nayla para hospedagem sem disco persistente

## Estado atual

A API usa `better-sqlite3` em `server/db.ts` e aproximadamente 326 chamadas síncronas de banco em 15 arquivos do servidor. Algumas tabelas de cobranças, notificações e lembretes são criadas pelos próprios módulos na inicialização. Por isso, trocar apenas `DATABASE_PATH` ou importar um arquivo para um banco remoto **não** faz a API atual funcionar na Vercel. O bloqueio em `server/db.ts` impede que uma Function aceite agendamentos e pagamentos em um SQLite descartável. `DATABASE_PATH=/tmp/...` também não resolve a persistência.

Turso/libSQL é o alvo proposto para manter o dialeto SQLite. A [Turso documenta a importação de arquivos SQLite](https://turso.tech/blog/migrating-and-importing-sqlite-to-turso-just-got-easier). O [plano Free e os limites atuais](https://turso.tech/pricing) devem ser conferidos na contratação; não há garantia de custo zero ao crescer. A migração da **API** continua pendente: o cliente remoto é assíncrono e exige adaptar as chamadas, transações e inicialização de esquema em todos os módulos que usam `db`.

## Fazer uma cópia consistente do banco existente

No computador ou servidor que contém o banco real, informe os caminhos explícitos:

```powershell
node scripts/backup-sqlite.mjs "C:\caminho\nayla.db" "C:\backup\nayla-2026-10-21.db"
```

O script usa a API de backup do SQLite, inclui transações confirmadas que ainda estejam no arquivo WAL, recusa sobrescrever um arquivo existente, verifica integridade e chaves estrangeiras, prepara a cópia em modo WAL e mostra SHA-256 e contagens por tabela. Ele não altera o banco de origem. Guarde a cópia fora do repositório com acesso restrito: contém nomes, telefones, CPF, histórico de clientes e dados financeiros. O `.gitignore` exclui arquivos `.db` e `.sqlite`, mas isso não substitui controle de acesso e backup criptografado.

Para uma migração final, interrompa novas escritas na API antes de criar a **última** cópia. Uma cópia feita enquanto o sistema atende clientes é consistente até aquele instante, mas não inclui agendamentos e pagamentos criados depois. Mantenha o original para recuperação até validar a nova operação.

## Importação futura para Turso

Depois que a API assíncrona e seus testes de ponta a ponta estiverem prontos:

1. Crie uma conta e uma região de banco apropriada no Turso. Não coloque tokens no Git ou em variáveis `VITE_*`, que são públicas no navegador.
2. Importe a cópia pelo comando documentado: `turso db import "C:\backup\nayla-2026-10-21.db"`. Confira a [documentação do comando](https://docs.turso.tech/cli/db/import) antes de executar, pois a CLI e os planos podem mudar.
3. Compare no banco remoto as contagens exibidas no relatório local, especialmente `businesses`, `users`, `services`, `appointments`, `financial_entries`, `business_billing`, `billing_recurring`, `notification_outbox` e `reminder_deliveries`, quando presentes. Verifique também chaves estrangeiras e ao menos um agendamento e uma cobrança de teste sem usar dados reais de cartão.
4. Configure a URL e o token remoto apenas no ambiente do backend e faça o corte de tráfego após validar criação, remarcação, cancelamento, cobrança, webhook, lembretes e reconciliação. Mantenha ambientes de Preview separados da produção.

**Ainda não execute a importação como forma de publicação.** A aplicação atual continuará escrevendo no arquivo local. Esse procedimento prepara uma transferência verificável dos dados; a refatoração das consultas síncronas para o cliente remoto precisa ser concluída antes do corte.

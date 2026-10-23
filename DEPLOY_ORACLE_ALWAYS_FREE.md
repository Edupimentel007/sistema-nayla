# Hospedar a Nayla em uma VM Oracle Always Free

Este é um caminho para testar a Nayla fora do computador sem usar a Vercel. A **mesma VM** entrega a interface web/PWA, a API Express, o banco SQLite e o trabalhador que verifica lembretes a cada minuto. O recebimento das mensalidades continua fora do app e o super admin libera ou bloqueia o acesso manualmente.

**Não há implantação ativa neste repositório.** Para publicar, ainda são necessários uma conta Oracle Cloud, uma VM disponível na região da conta, um nome DNS público apontado para ela e as chaves privadas dos provedores. A oferta Always Free tem limites e pode ficar sem capacidade ou ter instâncias ociosas recuperadas pela Oracle. Confira na criação da VM que cada recurso está marcado **Always Free** e acompanhe o uso; não há garantia de custo zero, disponibilidade ou desempenho. [Limites e condições oficiais da Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

## 1. Criar a VM e proteger o acesso

1. Crie a conta em [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) e escolha a região principal. O cadastro e a verificação da conta são feitos por você; não compartilhe credenciais, cartão nem chave SSH no chat.
2. Em **Compute → Instances → Create instance**, escolha uma imagem Ubuntu Linux compatível com Arm e a forma `VM.Standard.A1.Flex` **Always Free**. Como ponto de partida, use até 2 OCPUs e 12 GB de memória no total da conta e um boot volume dentro da franquia. A forma x86 Micro tem apenas 1 GB de RAM e pode ser insuficiente para compilar o app. Pode ocorrer erro de falta de capacidade; isso exige esperar ou tentar outro domínio de disponibilidade da região. [Formas e limites](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
3. Gere uma chave SSH no seu computador e forneça **só a chave pública** ao criar a instância. Restrinja a porta TCP 22 ao seu IP de administração. No grupo de segurança de rede da VM, permita TCP 80 e 443 para acesso público; mantenha 3001 (Node), 11434 (Ollama) e qualquer porta de banco fechadas. Se ativar firewall no Linux, libere o SSH antes de ativá-lo para não perder o acesso. A Oracle recomenda [Network Security Groups](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/networksecuritygroups.htm) para essas regras.
4. Aponte o registro DNS **A** de um nome estável que você controla para o IP público da VM. O exemplo abaixo usa `app.example.com`; substitua pelo seu nome real em todos os pontos. O domínio/serviço de DNS pode ter custo separado. Se o IP público mudar, atualize o DNS antes de convidar novas profissionais.

Para um piloto sem comprar domínio, é possível registrar gratuitamente um subdomínio `nomedanayla.duckdns.org` no [DuckDNS](https://www.duckdns.org/about.jsp) e apontá-lo para a VM. Use esse nome completo no `APP_ORIGIN`, no Caddyfile e nos callbacks Google/Meta. Atualize o IP pelo painel DuckDNS quando ele mudar ou configure o [atualizador HTTPS oficial](https://www.duckdns.org/spec.jsp) guardando o token fora do Git e sem `curl -k`. O DuckDNS é um terceiro sem garantia de continuidade; se você perder ou trocar o nome, links de agendamento, retorno Google, webhook Meta e instalação PWA precisam ser reconfigurados. **Antes de prometer login Google no piloto, confirme que o Google aceita e permite verificar esse subdomínio no seu projeto OAuth**; aplicativos de produção exigem domínio verificável sob sua autorização. Se a verificação falhar, o login com senha continua disponível e o Google dependerá de um domínio aceito. [Política oficial do Google OAuth](https://developers.google.com/identity/protocols/oauth2/policies). Para uso contínuo, um domínio sob seu controle oferece mais estabilidade de marca, mas pode custar.

## 2. Instalar Node, Caddy e o código

Conecte-se por SSH com o usuário da imagem (em Ubuntu, normalmente `ubuntu`). Atualize o sistema e instale `git`, `python3`, `make`, compilador C/C++ e `sqlite3`. Instale uma versão **LTS do Node que satisfaça `^20.19.0 || >=22.12.0`** a partir de [Node.js oficial](https://nodejs.org/en/download) e confirme com `node --version` e `npm --version`. No Arm, `better-sqlite3` e `sharp` podem precisar de binários Arm ou compilação local; `npm ci` deve terminar sem erro. Não execute o app como `root`.

Instale o Caddy usando o pacote para Ubuntu e as instruções do [projeto Caddy](https://caddyserver.com/docs/install). O pacote inicia o serviço `caddy` via systemd. Evite executar scripts baixados da internet sem verificar a origem.

```sh
sudo useradd --system --create-home --home-dir /srv/nayla --shell /usr/sbin/nologin nayla
sudo -u nayla git clone https://github.com/Edupimentel007/sistema-nayla.git /srv/nayla/app
cd /srv/nayla/app
sudo -u nayla npm ci
sudo -u nayla npm run build
sudo -u nayla npm test
```

Os exemplos de serviço usam `/srv/nayla/app`. Se escolher outra pasta ou outro usuário, ajuste os dois arquivos `.service` antes de copiá-los. `npm ci` instala também dependências de desenvolvimento necessárias ao build.

## 3. Configurar o ambiente privado

Crie `/etc/nayla/nayla.env` fora do repositório e da pasta pública `dist/`, com dono `root` e modo `0600`. O systemd lê o arquivo e entrega as variáveis apenas ao processo da Nayla. Outros administradores do servidor e processos executados como `nayla` ainda podem acessar esses segredos: restrinja SSH e não instale serviços desconhecidos na VM.

```sh
sudo install -d -o root -g root -m 0700 /etc/nayla
sudo install -o root -g root -m 0600 /dev/null /etc/nayla/nayla.env
sudoedit /etc/nayla/nayla.env
```

Preencha o arquivo com os valores da **sua** implantação, sem aspas ao redor dos valores simples:

```ini
NODE_ENV=production
PORT=3001
LISTEN_HOST=127.0.0.1
TRUST_PROXY=1
APP_ORIGIN=https://app.example.com
DATABASE_PATH=/var/lib/nayla/nayla.sqlite
BACKUP_DIR=/var/lib/nayla-backups
ACCESS_IDENTITY_SECRET=COLE_AQUI_32_BYTES_ALEATORIOS_EM_BASE64
WHATSAPP_ENCRYPTION_KEY=COLE_AQUI_OUTROS_32_BYTES_ALEATORIOS_EM_BASE64
WHATSAPP_MODE=disabled
AI_PROVIDER=groq
GROQ_API_KEY=COLE_AQUI_SUA_CHAVE_PRIVADA
```

Gere **cada** chave de 32 bytes separadamente no terminal privado do servidor com `openssl rand -base64 32`. Não envie valores no chat, não os coloque no Git e não use prefixo `VITE_`. Guarde cópia segura do arquivo: trocar `ACCESS_IDENTITY_SECRET` perde a comparação anterior de identidades do teste; trocar `WHATSAPP_ENCRYPTION_KEY` impede ler credenciais Meta já salvas. Se usar o **banco local existente**, mantenha os mesmos dois segredos da instalação local. O arquivo aceita ainda `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`; cadastre `https://app.example.com/api/auth/google/callback` no Google OAuth. As contas de cada profissional recebem a própria configuração Meta pelo painel, conforme [guia do WhatsApp](GUIA_WHATSAPP_PROFISSIONAIS.md). Sem Groq configurado, o chat livre não responde; use a conta Groq Free com limites para evitar cobranças inesperadas.

`APP_ORIGIN` deve ser a URL HTTPS **exata** usada no navegador. `LISTEN_HOST=127.0.0.1` impede acesso público direto à API; `TRUST_PROXY=1` faz o Express reconhecer o HTTPS entregue pelo Caddy. Não libere a porta 3001 na Oracle ou no firewall do Linux.

## 4. Iniciar o app e ativar HTTPS

```sh
sudo cp /srv/nayla/app/deploy/oracle/nayla.service /etc/systemd/system/
sudo cp /srv/nayla/app/deploy/oracle/nayla-backup.service /etc/systemd/system/
sudo cp /srv/nayla/app/deploy/oracle/nayla-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nayla.service
sudo systemctl enable --now nayla-backup.timer
curl --fail http://127.0.0.1:3001/api/health
```

Copie `deploy/oracle/Caddyfile.example` para `/etc/caddy/Caddyfile`, edite `app.example.com` para o seu DNS e valide antes de recarregar:

```sh
sudo cp /srv/nayla/app/deploy/oracle/Caddyfile.example /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl --fail https://app.example.com/api/health
```

O Caddy obtém e renova o certificado público automaticamente quando o DNS aponta para a VM e as portas 80/443 estão acessíveis. [Guia oficial de HTTPS do Caddy](https://caddyserver.com/docs/quick-starts/https). Se a resposta externa falhar, confira DNS, regras de rede, firewall local e `sudo journalctl -u caddy -n 100 --no-pager`. Nunca desative a verificação TLS para contornar um certificado inválido.

## 5. Banco, backup e restauração

O banco principal fica em `/var/lib/nayla/nayla.sqlite`, fora do Git e da pasta pública. `nayla-backup.timer` executa um backup diário às 03:00 **no fuso horário configurado na VM**. O script usa a API de backup online do SQLite e testa integridade/chaves estrangeiras antes de publicar o arquivo em `/var/lib/nayla-backups`. Não use `cp` simples em um banco WAL em uso. [API de backup do SQLite](https://sqlite.org/backup.html).

```sh
sudo systemctl start nayla-backup.service
sudo systemctl status nayla-backup.service --no-pager
sudo systemctl list-timers nayla-backup.timer
sudo journalctl -u nayla-backup.service -n 30 --no-pager
sudo ls -l /var/lib/nayla-backups/
```

Os backups locais ficam no **mesmo boot volume** da VM; por si só não protegem contra exclusão da instância, falha do volume ou perda da conta. Configure uma política de **boot volume backup** dentro da franquia Always Free disponível e mantenha também uma cópia externa cifrada, com restauração ensaiada. Monitore espaço e retenção; o script não apaga backups automaticamente. A Oracle documenta [backups do boot volume](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/bootvolumebackups.htm) e os [limites Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Para restaurar um backup: pare `nayla.service` e o timer, confirme que nenhum backup está em execução, copie **todos** os arquivos `nayla.sqlite*` atuais para uma pasta privada de quarentena, coloque uma cópia do backup escolhido em `/var/lib/nayla/nayla.sqlite` com dono `nayla:nayla` e modo `0600`, e deixe os antigos arquivos `-wal`/`-shm` apenas na quarentena. Rode `sqlite3 /var/lib/nayla/nayla.sqlite 'PRAGMA integrity_check; PRAGMA foreign_key_check;'`: a primeira linha deve ser `ok` e a segunda consulta não deve listar erros. Só então inicie `nayla.service` e o timer e teste login e agenda. Guarde os arquivos antigos até confirmar os dados restaurados. A restauração volta também contas, sessões e concessões de acesso à data do backup.

Para levar o banco do computador atual para a VM, primeiro faça um snapshot com `node scripts/backup-sqlite.mjs <banco-local> <arquivo-novo.db>` no computador. Transfira-o por SSH com permissões restritas e siga o procedimento de restauração acima **antes de permitir novos agendamentos**. Nunca sincronize o arquivo SQLite ativo diretamente. Sem essa importação, o servidor começa vazio; crie a conta do proprietário no novo site e execute `npm run admin:promote -- email@exemplo.com` em um terminal privado do servidor para habilitar o super admin. O comando pede a senha sem mostrá-la.

## 6. Verificar antes de convidar profissionais

1. Confirme `https://app.example.com/api/health` com `{"ok":true}` e abra `/entrar`, `/cadastro` e `/superadmin` no navegador. O painel super admin só deve mostrar dados após login da conta promovida; abrir a rota sozinha não comprova autorização.
2. No celular Android e no Safari do iPhone, abra o mesmo endereço HTTPS, entre e adicione a PWA à tela inicial. Isto **não** publica um binário nas lojas App Store/Google Play.
3. Cadastre uma profissional de teste, libere o acesso pelo super admin, cadastre uma cliente, marque, altere e cancele um horário. Confirme agenda, financeiro, inbox e histórico Nayla em outro dispositivo e **após reiniciar** `nayla.service`.
4. Confira os lembretes do app, depois configure e teste os modelos WhatsApp da profissional conforme o guia. Sem a Cloud API e os modelos aprovados, não há envio real por WhatsApp. O trabalhador de lembretes já roda na API; não configure um segundo cron disparando a mesma tarefa.
5. Faça e inspecione um backup. Verifique `sudo systemctl status nayla.service caddy nayla-backup.timer --no-pager`, logs (`sudo journalctl -u nayla.service -n 100 --no-pager`) e espaço em disco. Nunca cole logs contendo dados de clientes ou chaves em mensagens públicas.

Links públicos após configurar **seu domínio**: `https://app.example.com/entrar`, `https://app.example.com/cadastro`, `https://app.example.com/superadmin` e `https://app.example.com/agendar/SLUG-DA-PROFISSIONAL`. Esses são exemplos, não endereços já publicados.

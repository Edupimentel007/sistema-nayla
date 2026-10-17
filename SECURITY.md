# Segurança da Nayla

Este documento descreve as proteções implementadas e os requisitos para operar a Nayla com dados reais. Segurança depende também da hospedagem, da configuração dos provedores, de atualizações e da operação contínua. Nenhum software pode garantir ausência de vulnerabilidades.

## Proteções no aplicativo

- Senhas usam bcrypt; sessões usam tokens aleatórios cujos hashes ficam no banco. Cookies web são `HttpOnly`, `SameSite=Lax` e `Secure` em produção. A opção de manter conectado expira em até sete dias.
- Profissionais e clientes têm papéis separados. A API filtra dados por `business_id`, confere propriedade de agendamentos e usa parâmetros nas consultas SQL.
- Alterações feitas por navegador passam por validação de `Origin`, `Referer` e `Sec-Fetch-Site`. O app Capacitor usa token Bearer guardado no armazenamento seguro da plataforma. A configuração de produção exige `APP_ORIGIN` HTTPS exata.
- Respostas usam política de conteúdo, proteção contra enquadramento, `nosniff`, política de referenciador e `Cache-Control: no-store` para APIs. HSTS é enviado em respostas HTTPS de produção.
- A logo enviada é limitada a 1 MB e 16 milhões de pixels, decodificada e regravada como WebP de até 1024 px. Isso remove metadados como EXIF/GPS e conteúdo anexado ao arquivo. Uploads inválidos são recusados.
- As credenciais da Cloud API do WhatsApp são cifradas no banco com AES-256-GCM e uma chave fora do banco. Tokens e segredos de pagamento, Google e IA ficam somente no servidor.
- O cartão é preenchido no checkout hospedado do provedor. A Nayla não recebe nem armazena número do cartão ou CVV. O Pix é obtido do provedor, com QR dinâmico e código copia e cola. A ativação do plano depende do webhook autenticado e do estado da cobrança.
- Os webhooks do WhatsApp verificam HMAC. Webhooks de pagamento Mercado Pago exigem assinatura HMAC válida; a Nayla consulta o pagamento novamente na API do Mercado Pago e confere referência, moeda e valor antes de ativar o plano. Repetições não estendem o período novamente.

## Antes de publicar

1. Hospede o site e a API em HTTPS, defina `NODE_ENV=production` e `APP_ORIGIN` com a origem pública exata. Mantenha redirecionamento HTTP → HTTPS e TLS atualizado no proxy. Ative `TRUST_PROXY=1` somente se o servidor estiver atrás de um proxy confiável que substitui os cabeçalhos de encaminhamento.
2. Guarde `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY` e `WHATSAPP_ENCRYPTION_KEY` em um cofre de segredos ou variáveis protegidas no servidor. Nunca use prefixo `VITE_` para segredos; nunca os inclua no Git, no app mobile ou em mensagens de suporte. Use credenciais diferentes em teste e produção.
3. Restrinja a leitura do arquivo SQLite e de seus backups à conta do processo. Use disco e backups cifrados, faça cópias automáticas, teste restauração e limite a retenção. CPF, telefone e dados financeiros ainda estão em texto no banco; a cifra do disco e dos backups é necessária para reduzir exposição se a mídia for perdida.
4. Configure limites de acesso no proxy/firewall e monitoramento de tentativas, erros e eventos de pagamento. Os limites de requisição internos são por processo; em várias instâncias, acrescente um limitador compartilhado no gateway. Restrinja o acesso administrativo à infraestrutura e mantenha Node, sistema operacional e dependências atualizados.
5. Valide no painel Mercado Pago o recebedor, as credenciais de teste e produção, a assinatura secreta do webhook, os valores e a URL antes de liberar cobranças reais. Ative 12 parcelas sem juros na conta antes de anunciar R$ 420 em 12 × R$ 35; as taxas de financiamento cabem ao vendedor. Não peça número de cartão, CVV, senha bancária ou token de API a profissionais ou clientes pelo chat. No pagamento Pix, oriente a pessoa a conferir o beneficiário e o valor no aplicativo do banco antes de confirmar.
6. Publique uma política de privacidade e uma rotina de atendimento a solicitações de acesso, correção e exclusão. CPF e telefone são dados pessoais. Limite o acesso operacional aos dados das clientes e evite registrar corpos de requisição, códigos Pix, sessões ou segredos em logs.
7. Execute `npm.cmd audit`, `npm.cmd test` e `npm.cmd run build` antes de publicar. Faça testes de invasão autorizados na implantação real e repita após mudanças relevantes.

## Limites conhecidos

- A política de conteúdo permite estilos inline usados pela interface e CSS/fontes do Google. Ela reduz o impacto de vários ataques de injeção, mas não substitui validação, revisão de código nem uma política com nonce para scripts caso o app passe a usar código inline.
- Rate limiting em memória não coordena múltiplas instâncias e não substitui proteção contra DDoS no provedor de hospedagem.
- O banco SQLite não cifra CPF, telefone e financeiro por campo. A criptografia de disco, dos backups e o controle de acesso fazem parte da implantação.
- Notificações push e mensagens WhatsApp podem ser atrasadas por navegador, sistema operacional, rede ou provedor. Não devem ser usadas como única fonte de verdade para o estado do agendamento.
- O teste de 30 dias exige cartão. A integração de cobrança avulsa Checkout Pro cobra imediatamente, então não valida um cartão sem pagamento. O teste permanece indisponível até existir um fluxo do Mercado Pago que confirme o cartão sem cobrança indevida, com status consultado no servidor; criar conta ou voltar do checkout não inicia o teste.

Referências: [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html), [sharp security](https://sharp.pixelplumbing.com/security/).

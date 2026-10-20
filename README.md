# Ingressos Invictus — Party do Saco Cheio

Plataforma de venda de ingressos da **Associação Atlética Acadêmica de Medicina de Telêmaco Borba — Invictus (A.A.A.MED.TB)**.

- Página do evento com a identidade do cartaz (preto + verde neon + Puma).
- Compra em 2 etapas: dados → pagamento (**Pix** ou **cartão de crédito**, ambos pelo **Checkout Pro** do Mercado Pago, que abre o checkout oficial deles e devolve o comprador ao site).
- Preço + **taxa de serviço de R$ 3,00** (configurável), sempre exibidos separadamente antes de pagar.
- Confirmação **só pelo servidor** (webhook assinado + consulta à API do Mercado Pago). Voltar para a "página de sucesso" não confirma nada.
- Banco PostgreSQL com travas contra confirmação dupla, ingresso duplicado e venda acima da lotação.
- Painel da organização com login: resumo financeiro, busca de compradores, **lista de entrada para imprimir (A4)**, exportação CSV, **transferência de ingresso (troca de nome)**, abrir/fechar vendas, preços, taxa, lotação, regras e auditoria.

> Não existe portal de portaria: a lista oficial é impressa pelo painel (`/admin/lista`).

---

## Sumário

1. [O que ainda falta definir (antes de publicar)](#1-o-que-ainda-falta-definir-antes-de-publicar)
2. [Tecnologias e estrutura](#2-tecnologias-e-estrutura)
3. [Rodar no seu Mac (passo a passo)](#3-rodar-no-seu-mac-passo-a-passo)
4. [Configurar o Mercado Pago](#4-configurar-o-mercado-pago)
5. [Criar o primeiro administrador](#5-criar-o-primeiro-administrador)
6. [Publicar em produção (Railway)](#6-publicar-em-produção-railway)
7. [Checklist do dia da publicação](#7-checklist-do-dia-da-publicação)
8. [Lista de entrada, exportação e cópia de segurança](#8-lista-de-entrada-exportação-e-cópia-de-segurança)
9. [Serviços externos e custos](#9-serviços-externos-e-custos)
10. [Segurança e LGPD](#10-segurança-e-lgpd)
11. [Testes](#11-testes)
12. [Como o pagamento funciona por dentro](#12-como-o-pagamento-funciona-por-dentro)

---

## 1. O que ainda falta definir (antes de publicar)

Esses dados **não foram fornecidos** e por isso **não foram inventados**. Enquanto os obrigatórios estiverem vazios, o painel **não deixa abrir as vendas**. Tudo é preenchido em **/admin/configuracoes**, sem mexer no código.

| Informação | Obrigatória para vender? |
| --- | --- |
| Credenciais do Mercado Pago (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) | ✅ Sim — é a única pendência obrigatória |
| Endereço do local | ⚠️ Não — só o nome "Santo Gole" aparece |
| Limite de ingressos (lotação) | ⚠️ Não — vazio = sem limite (o painel avisa) |
| Horário de término, e-mail, Instagram | Opcionais |
| Preço do camarote | Não é vendido online nesta versão |

Já configurado com o que foi informado: nome **Party do Saco Cheio**, **24/10/2026 a partir das 23:30**, local **Santo Gole**, contato **(42) 99137-4203** (WhatsApp), frase do cartaz, parceria **Santo Gole**, preços **Feminino R$ 20,00** e **Masculino R$ 30,00**, **taxa de R$ 3,00 por ingresso**, regras de entrada, texto do camarote, **compra sem cancelamento/reembolso**, **transferência por mensagem ao contato da organização** e, **se a festa for cancelada, a organização entra em contato** com quem comprou.

**Telefone do comprador:** o formulário pede **celular/WhatsApp** (obrigatório) para que a organização consiga avisar em caso de cancelamento. Ele aparece no detalhe de cada compra (com link do WhatsApp) e no CSV "todas as compras" — **não** aparece na lista impressa. É apagado junto com o nome na anonimização.

> A política "não dá para cancelar" foi escrita com a ressalva "ressalvados os direitos previstos no Código de Defesa do Consumidor": o CDC (art. 49) garante arrependimento em até 7 dias em compras pela internet, e uma regra que tente anular isso não vale. Ajuste o texto no painel se quiser.

**Transferência:** quando alguém pedir por mensagem, abra a compra em **/admin/compras → Detalhes → Transferir ingresso** e digite o nome completo da nova pessoa. A lista impressa e o CSV já saem com o nome novo (o código interno continua o mesmo).

Os valores iniciais ficam em [`src/config/event.ts`](src/config/event.ts) e são copiados para o banco na primeira migração. Depois disso, valem os do painel.

---

## 2. Tecnologias e estrutura

- **Next.js 16** (React 19, TypeScript) — site + API no mesmo projeto.
- **PostgreSQL** — banco de dados (biblioteca `postgres`, consultas parametrizadas).
- **Mercado Pago** — API REST oficial: `/checkout/preferences` (Checkout Pro, Pix e cartão), `/v1/payments/{id}`, `/v1/payments/search`, `/v1/payments/{id}/refunds`.
- **Zod** — validação dos dados no servidor.
- **Vitest** + **Playwright** — testes.

```
migrations/001_init.sql        → tabelas, restrições e índices
scripts/migrate.ts             → aplica migrações e cria a configuração inicial
scripts/create-admin.ts        → cria/redefine administrador (senha digitada no terminal)
src/config/event.ts            → dados iniciais do evento (pendências marcadas)
src/server/purchases.ts        → criação da compra, máquina de estados do pagamento, conciliação
src/server/mercadopago.ts      → cliente da API do Mercado Pago
src/server/webhook-signature.ts→ validação da assinatura x-signature
src/server/auth.ts             → login, sessão e proteção do painel
src/app/                       → páginas (/, /comprar, /pedido/[id], /regras, /privacidade, /admin/...)
src/app/api/                   → endpoints (compra, status, webhook, painel, cron)
src/proxy.ts                   → Content-Security-Policy com nonce
tests/unit, tests/e2e          → testes automatizados
tests/mock-mp/server.mjs       → simulador LOCAL do Mercado Pago (só para testes)
```

---

## 3. Rodar no seu Mac (passo a passo)

Abra o app **Terminal** (⌘ + espaço → "Terminal").

**3.1. Instalar as ferramentas (uma vez só)**

```bash
# Homebrew (gerenciador de programas do Mac) — pule se já tiver
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node@22 postgresql@16 git
brew services start postgresql@16
```

**3.2. Baixar o projeto e instalar dependências**

```bash
git clone https://github.com/eckermann33/aaamedtb-venda-de-ingressos.git
cd aaamedtb-venda-de-ingressos
npm install
```

**3.3. Criar o banco local**

```bash
createdb invictus
```

**3.4. Criar o arquivo `.env`**

```bash
cp .env.example .env
open -e .env    # abre no TextEdit
```

Preencha pelo menos:

```
DATABASE_URL=postgres://SEU_USUARIO_DO_MAC@localhost:5432/invictus
DATABASE_SSL=disable
APP_URL=http://localhost:3000
APP_SECRET=   ← cole o resultado de: openssl rand -hex 32
```

(Descubra seu usuário do Mac com o comando `whoami`.)

**3.5. Criar as tabelas, o administrador e rodar**

```bash
npm run db:migrate
npm run admin:create -- seu-email@exemplo.com
npm run dev
```

Abra http://localhost:3000 (site) e http://localhost:3000/admin (painel).

**Sem credenciais do Mercado Pago?** Dá para ver o fluxo completo com o simulador local (não é o Mercado Pago de verdade, não cobra nada):

```bash
# Terminal 1
MP_WEBHOOK_SECRET=segredo-local node tests/mock-mp/server.mjs
# Terminal 2 (adicione no .env: MP_API_BASE_URL=http://127.0.0.1:4010, MP_ACCESS_TOKEN=TEST-mock, MP_WEBHOOK_SECRET=segredo-local)
npm run dev
```

---

## 4. Configurar o Mercado Pago

**Modalidade usada: Checkout Pro** (API de **Preferências**, `POST /checkout/preferences`), para Pix e cartão:

- O comprador escolhe **Pix** ou **Cartão** no nosso site e é levado ao ambiente do Mercado Pago (o site avisa isso). Lá ele vê o QR Code/copia e cola do Pix ou digita o cartão, e volta para o nosso site.
- **Nenhum dado de cartão, e-mail ou CPF passa pelo nosso servidor.** Cada preferência oferece só a forma escolhida (Pix **ou** cartão de crédito, em parcela única), para o comprador pagar exatamente o total exibido.
- Quando o Mercado Pago perguntar qual solução integrar, escolha **Checkout Pro**.
- A documentação do Mercado Pago também tem a **API de Orders** (`/v1/orders`), recomendada para integrações novas. Mantivemos a API de Preferências porque ela continua suportada e seus campos foram conferidos no SDK oficial; a migração para Orders pode ser feita depois do evento.

### 4.1. Criar a aplicação

1. Entre em https://www.mercadopago.com.br/developers com a **conta do Mercado Pago que vai receber o dinheiro** (de preferência a conta da Atlética).
2. **Suas integrações → Criar aplicação**. Tipo de solução: pagamentos online; produto: **Checkout Pro** (se perguntar a plataforma, escolha que não usa plataforma de e-commerce).
3. Para receber **Pix**, a conta precisa ter uma **chave Pix cadastrada** no app do Mercado Pago.

### 4.2. Credenciais de teste e de produção

Em **Suas integrações → (sua aplicação) → Credenciais**:

- **Credenciais de teste**: use no desenvolvimento. Faça os testes com **usuários de teste** (comprador e vendedor) criados em *Suas integrações → Contas de teste*, e com os **cartões de teste** listados na documentação oficial de testes do Mercado Pago (o nome do titular do cartão define o resultado, ex.: aprovado/recusado).
- **Credenciais de produção**: só na publicação. Pode ser preciso "ativar credenciais de produção" informando o site.

Copie o **Access Token** para a variável `MP_ACCESS_TOKEN` (no `.env` local ou nas variáveis do servidor). **Nunca** coloque o token no código, em prints ou no GitHub.

> ⚠️ Não consegui acessar o site do Mercado Pago a partir do ambiente onde o código foi feito, então **nenhum teste foi feito contra o Mercado Pago real** (nem sandbox). Os nomes de campos foram conferidos no SDK oficial `mercadopago` (v3.6.1). Faça o roteiro de testes da seção 7 com credenciais de teste antes de abrir as vendas.

### 4.3. Configurar o webhook (obrigatório)

1. **Suas integrações → (sua aplicação) → Webhooks → Configurar notificações.**
2. **URL de produção**: `https://SEU-DOMINIO/api/webhooks/mercadopago`
   (para testes, preencha a URL de teste com o mesmo endereço do ambiente de teste publicado — o Mercado Pago não alcança `localhost`).
3. **Eventos**: marque **Pagamentos**.
4. Salve e copie a **Assinatura secreta** → variável `MP_WEBHOOK_SECRET`.
5. Use o botão **Simular notificação** do painel do Mercado Pago: em `/admin/auditoria` deve aparecer a notificação com "assinatura válida".

Como o webhook é tratado:
- valida a assinatura `x-signature` (HMAC-SHA256 do manifesto `id:...;request-id:...;ts:...;`);
- **não confia no conteúdo**: consulta o pagamento na API com o Access Token;
- confere `external_reference` (a compra), **valor** e **moeda**;
- é idempotente: notificações repetidas não duplicam nada;
- responde 500 em falha temporária para o Mercado Pago reenviar.

### 4.4. Rotina de conciliação (rede de segurança)

Se algum webhook se perder, as compras pendentes são conferidas:
- automaticamente quando o comprador abre/atualiza a página do pedido;
- pelo botão **"Conferir pendentes no Mercado Pago"** no painel;
- por uma chamada periódica a `GET /api/cron/reconcile` com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

Para a chamada periódica, use o **Cron** da Railway ou um serviço gratuito como o cron-job.org, a cada 5–10 minutos.

---

## 5. Criar o primeiro administrador

O painel **não tem senha no código**. Administradores ficam no banco, com senha protegida por hash **scrypt**.

```bash
npm run admin:create -- diretoria@exemplo.com
```

O terminal pede a senha duas vezes (ela não aparece enquanto você digita). Mínimo 12 caracteres, com letras e números. Rodar de novo com o mesmo e-mail **redefine a senha** e derruba as sessões abertas.

Em produção (Railway), rode o mesmo comando **no seu Mac** apontando para o banco de produção:

```bash
DATABASE_URL="URL_PUBLICA_DO_BANCO_DA_RAILWAY" npm run admin:create -- diretoria@exemplo.com
```

(ou `railway run npm run admin:create -- diretoria@exemplo.com` com a CLI da Railway). Crie um login por pessoa da diretoria — a auditoria mostra quem fez cada ação.

---

## 6. Publicar em produção (Railway)

Escolhi a **Railway** porque roda o app e o PostgreSQL no mesmo lugar, com HTTPS automático e deploy direto do GitHub. (Funciona também em Render, Fly.io ou qualquer servidor Node 20+ com Postgres.)

1. Crie conta em https://railway.com e faça login com o GitHub.
2. **New Project → Deploy from GitHub repo** → escolha este repositório.
3. No mesmo projeto: **New → Database → PostgreSQL**.
4. No serviço do app → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (referência ao banco)
   - `APP_URL` = `https://SEU-DOMINIO` (veja o passo 6)
   - `APP_SECRET` = resultado de `openssl rand -hex 32`
   - `CRON_SECRET` = outro `openssl rand -hex 32`
   - `MP_ACCESS_TOKEN` = Access Token (teste primeiro, produção depois)
   - `MP_WEBHOOK_SECRET` = assinatura secreta do webhook
   - **Não** defina `MP_API_BASE_URL` nem `DATABASE_SSL` em produção.
5. **Settings → Deploy**:
   - Build command: `npm run build`
   - Pre-deploy command: `npm run db:migrate`
   - Start command: `npm start`
   - Healthcheck path: `/api/health`
6. **Settings → Networking → Generate Domain** (ou conecte um domínio próprio). Atualize `APP_URL` com esse endereço **https://**.
7. Configure o webhook (seção 4.3) com `https://SEU-DOMINIO/api/webhooks/mercadopago`.
8. Crie o administrador (seção 5), entre em `/admin/configuracoes`, preencha as pendências e só então **Abrir vendas** no resumo.
9. Crie o cron de conciliação (seção 4.4).

HTTPS: a Railway já entrega HTTPS; o app redireciona HTTP→HTTPS, envia HSTS e usa cookie `__Host-` seguro quando `APP_URL` começa com `https://`.

---

### 6.1. Alternativa: publicar na Vercel

O app roda na Vercel sem mudar código. A diferença é que a Vercel **não hospeda o PostgreSQL**: você cria o banco em outro serviço (Neon ou Supabase, ambos com região em São Paulo e plano gratuito) e a Vercel só roda o site.

1. **Banco:** crie um projeto no Neon (`neon.tech`) ou Supabase, **região São Paulo (sa-east-1)**. Copie **duas** URLs: a **direta** (para migrar) e a **com pooler** (para o site).
2. **Criar as tabelas** (uma vez, no seu Mac, usando a URL **direta**):
   ```bash
   DATABASE_URL="URL_DIRETA" npm run db:migrate
   DATABASE_URL="URL_DIRETA" npm run admin:create -- diretoria@exemplo.com
   ```
3. **Vercel:** em `vercel.com` → **Add New → Project** → importe este repositório do GitHub.
4. **Environment Variables** (as mesmas da Railway, mais três para o modo serverless):
   - `DATABASE_URL` = URL **com pooler**
   - `DATABASE_POOL_SIZE` = `1`
   - `DATABASE_PREPARE` = `false` (necessário em pooler modo transaction/PgBouncer)
   - `APP_URL`, `APP_SECRET`, `CRON_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (como na seção 6)
5. **Deploy.** Depois configure o webhook do Mercado Pago com `https://SEU-PROJETO.vercel.app/api/webhooks/mercadopago` (seção 4.3).
6. **Região das funções:** em *Settings → Functions → Function Region*, escolha **São Paulo (gru1)** para ficar perto do banco.
7. **Conciliação periódica:** use o **cron-job.org** (gratuito) chamando `GET https://SEU-SITE/api/cron/reconcile` a cada 5–10 min com o cabeçalho `Authorization: Bearer <CRON_SECRET>`. Não use o Cron da Vercel no plano gratuito: ele só roda **uma vez por dia**.

⚠️ **Plano da Vercel:** o plano gratuito (Hobby) é, segundo os termos da Vercel, para uso **não comercial**. Vender ingresso é cobrança, então **confira os termos atuais** antes de usar o Hobby em produção; o plano Pro é pago por mês. Na Railway não existe essa restrição, mas o app e o banco ficam num plano pago pequeno.

---

## 7. Checklist do dia da publicação

Com **credenciais de teste** publicadas:

- [ ] Compra feminina por Pix com usuário de teste → aparece "Pagamento aprovado" e o nome entra em `/admin/lista`.
- [ ] Compra masculina com cartão de teste aprovado → volta para o site aprovado.
- [ ] Cartão de teste recusado → "Pagamento recusado", nome fora da lista.
- [ ] Fechar o navegador depois de gerar o Pix e pagar → confirmação chega mesmo assim (webhook).
- [ ] `/admin/auditoria` mostra webhooks com **assinatura válida**.
- [ ] Estorno de teste pelo painel → compra vira "Estornado" e sai da lista.
- [ ] Exportar CSV e imprimir a lista.

Depois, troque `MP_ACCESS_TOKEN` (e o webhook/assinatura, se diferente) para **produção**, faça **uma compra real de valor baixo** com seu próprio cartão/Pix, confira e estorne pelo painel. Aí abra as vendas.

---

## 8. Lista de entrada, exportação e cópia de segurança

**Lista para imprimir:** painel → **Lista de entrada** → **Imprimir lista** (A4, ordem alfabética, caixinha "Entrou", número, categoria e código interno). Contém **somente pagamentos aprovados**. Feche as vendas antes de imprimir a versão final e leve duas cópias.

**CSV:** painel → "Baixar lista oficial (CSV)" (nome, categoria, código) ou "Baixar todas as compras (CSV)" (relatório financeiro). Abre direto no Excel/Numbers com acentos corretos.

**Cópia de segurança do banco** (faça antes do evento e depois do evento):

```bash
brew install postgresql@16   # se ainda não tiver o pg_dump
pg_dump "URL_PUBLICA_DO_BANCO" --format=custom --file=backup-invictus-$(date +%Y%m%d).dump
```

Para restaurar num banco vazio: `pg_restore --no-owner --dbname="URL_DO_BANCO" backup-invictus-AAAAMMDD.dump`.
Guarde o arquivo em local privado (ele contém nomes de participantes). A Railway também oferece backups automáticos do Postgres nos planos pagos.

---

## 9. Serviços externos e custos

Valores **de referência — confirme nos sites oficiais**, pois mudam com frequência e eu não consegui acessá-los deste ambiente:

| Serviço | Para quê | Custo aproximado |
| --- | --- | --- |
| Mercado Pago | Receber Pix e cartão | Sem mensalidade; **tarifa por venda** descontada do valor recebido (Pix costuma ser < 1%; cartão de crédito online, alguns %, variando com o prazo de recebimento). Veja "Custos" no app/site do Mercado Pago. |
| Railway | Hospedar app + PostgreSQL | Plano Hobby ≈ US$ 5/mês (inclui créditos de uso); um evento deste porte costuma caber nisso. |
| Domínio próprio (opcional) | Ex.: ingressos.suaatletica.com.br | `.com.br` ≈ R$ 40/ano no Registro.br. O domínio gratuito da Railway funciona. |
| cron-job.org (opcional) | Conciliação periódica | Gratuito |

A **taxa de serviço de R$ 3,00** entra no faturamento da Atlética (aparece separada no painel); as **tarifas do Mercado Pago** são descontadas pelo próprio Mercado Pago e **não** são somadas ao preço do comprador.

---

## 10. Segurança e LGPD

- Access Token, assinatura do webhook e segredos **somente em variáveis de ambiente** do servidor.
- Preço **sempre calculado no servidor** a partir do banco; campos de preço enviados pelo navegador são ignorados.
- Valor, moeda e referência do pagamento conferidos antes de confirmar.
- Banco: `UNIQUE` no ID do pagamento e no código do ingresso, `CHECK` garantindo que compra confirmada tem pagamento e código, total = preço + taxa, travas (`FOR UPDATE`) para lotação e confirmação.
- SQL injection: todas as consultas são parametrizadas.
- XSS: React escapa o conteúdo + **Content-Security-Policy com nonce**.
- CSRF: cookie `SameSite=Strict` + verificação de `Origin` em toda requisição que altera dados.
- Login: senha com scrypt, sessão em cookie `HttpOnly`/`Secure`, 12 h de validade, limite de tentativas por IP e por e-mail.
- Limite de requisições na compra, no status e no login (armazenado no banco, com IP em hash).
- Auditoria de login, alterações de configuração, abertura/fechamento de vendas, exportações, estornos e anonimizações.
- Erros técnicos ficam só nos logs do servidor (sem tokens, e-mails, códigos Pix ou dados de cartão).
- **Coleta mínima**: nome completo, celular/WhatsApp (avisos sobre o evento), categoria, aceite (versão + data/hora) e dados do pagamento. Sem CPF, endereço ou data de nascimento. O e-mail/CPF digitados no Mercado Pago ficam com ele.
- Nomes nunca aparecem em páginas públicas; a URL do pedido usa um identificador aleatório.
- **Retenção**: política padrão de anonimizar nomes em até 90 dias após o evento (configurável). Botão em `/admin/configuracoes` para anonimizar tudo e, em cada compra, para atender pedidos de exclusão do titular. Valores e IDs de pagamento ficam para prestação de contas.
- Política de privacidade em `/privacidade` — **revise com a diretoria** (é um modelo).

---

## 11. Testes

```bash
npm run typecheck     # verificação de tipos
npm test              # testes de integração (precisa de um Postgres de teste)
npm run build && npm run test:e2e   # testes no navegador (celular) com o simulador do Mercado Pago
```

Variáveis opcionais: `TEST_DATABASE_URL` e `E2E_DATABASE_URL` (precisam ter "test" ou "e2e" no nome — o banco é apagado a cada execução).

Resultado e limitações detalhados em [TESTES.md](TESTES.md).

---

## 12. Como o pagamento funciona por dentro

```
Comprador            Nosso servidor                         Mercado Pago
   │  dados + categoria  │                                       │
   ├────────────────────►│ valida, calcula preço+taxa no banco    │
   │                     │ trava lotação e cria compra PENDENTE   │
   │                     ├── cria preferência Checkout Pro ───────►│
   │◄── redireciona ─────┤    (idempotente, Pix OU cartão)        │
   │  paga no Mercado Pago (QR Code do Pix ou cartão) ──────────►│
   │                     │◄──────── webhook assinado ────────────┤
   │                     ├── consulta o pagamento na API ────────►│
   │                     │ confere valor/moeda/referência         │
   │                     │ CONFIRMA (código interno, lista)       │
   │◄─ página consulta o servidor e mostra "aprovado" ───────────│
```

Estados da compra: `pending` → `confirmed` | `rejected` | `expired` | `cancelled` | `failed`. Uma tentativa recusada, cancelada ou com Pix vencido **não encerra a compra**: o comprador pode tentar de novo enquanto a reserva estiver válida; e `confirmed` → `refunded` (estorno/chargeback). A vaga fica reservada por até 35 minutos enquanto o pagamento está pendente. Se um pagamento for aprovado depois que a lotação acabou, ele **não** entra na lista e aparece no painel como "precisa de atenção" para estorno.

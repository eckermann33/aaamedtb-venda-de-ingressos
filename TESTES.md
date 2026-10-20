# Relatório de testes

Executado em 20/10/2026, no ambiente de desenvolvimento (Linux, Node 22, PostgreSQL 16, Chromium com viewport de celular Pixel 7).

## O que foi testado e como

| Camada | Ferramenta | Resultado |
| --- | --- | --- |
| Tipos (TypeScript) | `npm run typecheck` | ✅ sem erros |
| Integração (regras de negócio + PostgreSQL real) | Vitest, `npm test` | ✅ 47/47 |
| Ponta a ponta (navegador de celular + app de produção + simulador do Mercado Pago) | Playwright, `npm run test:e2e` | ✅ 16/16 |
| Build de produção | `npm run build` | ✅ |

**Importante:** os testes de pagamento usam um **simulador local** do Mercado Pago (`tests/mock-mp/server.mjs`), que imita a API e envia webhooks assinados. O ambiente onde o projeto foi construído **não tem acesso à rede do Mercado Pago**, então **não houve teste contra o sandbox nem contra a produção do Mercado Pago**. Isso precisa ser feito antes de abrir as vendas (roteiro na seção 7 do README).

## Testes obrigatórios (item 15 do pedido)

| # | Cenário | Como foi verificado | Status |
| --- | --- | --- | --- |
| 1 | Compra de ingresso feminino | Integração (preço 20,00 + taxa 3,00 = 23,00) e navegador (Pix completo) | ✅ (simulador) |
| 2 | Compra de ingresso masculino | Integração (30,00 + 3,00 = 33,00) e navegador (cartão completo) | ✅ (simulador) |
| 3 | Cálculo correto dos preços | Integração: preço/taxa vindos do banco; alteração de preço vale para novas compras | ✅ |
| 4 | Validação dos campos obrigatórios | Navegador (mensagens na tela) e integração (nome vazio, só espaços, sem sobrenome, com símbolos) | ✅ |
| 5 | Bloqueio de menores de 18 anos | Navegador (não avança sem marcar) e API (400 com `adultConfirmed: false`) | ✅ |
| 6 | Pagamento por Pix | Navegador: QR Code, copia e cola, contagem regressiva; chave de idempotência `pix-<compra>` enviada | ✅ (simulador) |
| 7 | Pagamento por cartão | Navegador: redirecionamento ao checkout, parcela única, taxa como item separado, retorno aprovado | ✅ (simulador) |
| 8 | Pagamento aprovado | Confirma, gera código interno, entra na lista oficial | ✅ |
| 9 | Pagamento pendente | Permanece "aguardando", não conta como receita nem entra na lista | ✅ |
| 10 | Pagamento recusado | Pix recusado → "recusado"; cartão recusado → permite tentar outro cartão | ✅ |
| 11 | Webhook recebido mais de uma vez | 3 webhooks iguais → 1 confirmação, 1 ingresso, 1 registro de pagamento; 5 aplicações simultâneas → 1 confirmação | ✅ |
| 12 | Usuário fecha o navegador | Navegador fechado após gerar o Pix → webhook confirma; também conciliação sem webhook | ✅ |
| 13 | Falsificar o preço | Campos `amountCents`/`priceCents` enviados à API são ignorados; MP recebe o valor do banco; pagamento com valor diferente não confirma | ✅ |
| 14 | Painel sem autenticação | Páginas redirecionam ao login; exportação retorna 401; senha errada retorna 401 | ✅ |
| 15 | Pesquisa por nome | Busca "otavio" encontra "Otávio Mendes Luz" (sem acento/maiúsculas) | ✅ |
| 16 | Duas entradas para o mesmo ingresso | **Não se aplica**: por decisão da organização não há portal de portaria; a entrada é controlada na lista impressa (caixinha "Entrou"). O banco impede ingresso duplicado (`ticket_code` e `mp_payment_id` únicos). | — |
| 17 | Exportação da lista | CSV com BOM UTF-8, `;`, acentos corretos, só confirmados; proteção contra fórmulas | ✅ |
| 18 | Fechamento das vendas | Página mostra "Vendas fechadas"; API retorna 409; painel fecha/abre e impede abrir com pendências | ✅ |
| 19 | Limite de lotação | 10 compras simultâneas com lotação 3 → exatamente 3 reservas; reserva vencida libera vaga; aprovação tardia acima da lotação não entra na lista | ✅ |
| 20 | Dispositivos móveis | Todos os testes de navegador rodam em viewport de celular; sem rolagem horizontal; telas revisadas por captura (celular e desktop) | ✅ |

## Outros testes

- Assinatura do webhook: válida, ID adulterado, segredo errado, cabeçalho ausente/malformado; webhook forjado retorna 401 e fica registrado na auditoria.
- CSRF: `POST /api/purchases` com `Origin` de outro site → 403.
- Clique duplo: 4 envios com a mesma chave → 1 compra e 1 Pix.
- Falha do Mercado Pago ao criar pagamento → compra "falhou", sem reserva presa, mensagem amigável.
- Estorno pelo painel → "estornado", sai da lista; chargeback também.
- Pagamento duplicado na mesma compra → alerta; estorno do excedente limpa o alerta.
- E-mail do Pix não é gravado no banco.
- Versão dos termos e data/hora do aceite registradas; aceite de versão antiga é recusado.
- Senhas: hash scrypt com sal, verificação, regras mínimas.
- Lista impressa conferida em PDF A4.
- Transferência de ingresso pelo painel: nome trocado na lista impressa, código interno mantido; compra pendente não pode ser transferida.
- Telefone de contato: formatos comuns aceitos; número com letra (ex.: "429l1374203") é recusado em vez de virar outro número.

## Limitações conhecidas / o que falta

1. **Teste com o Mercado Pago real (sandbox e produção) não realizado** — sem acesso de rede ao Mercado Pago neste ambiente. Os campos da API foram conferidos no SDK oficial `mercadopago` v3.6.1, mas é obrigatório fazer o roteiro do README (seção 7).
2. **Dados do evento pendentes**: telefone de contato válido (o informado tem uma letra) e política em caso de cancelamento do evento (as vendas ficam bloqueadas até preencher).
3. A política de privacidade é um modelo — revise com a diretoria.
4. Testes em iPhone/Safari reais não foram feitos (apenas Chromium com perfil de celular).
5. Os valores de custo (Mercado Pago, Railway) no README são referências e devem ser confirmados nos sites oficiais.

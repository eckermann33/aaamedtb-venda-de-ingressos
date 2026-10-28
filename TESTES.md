# Relatório de testes

Executado em 20/10/2026, no ambiente de desenvolvimento (Linux, Node 22, PostgreSQL 16, Chromium com viewport de celular Pixel 7).

## O que foi testado e como

| Camada | Ferramenta | Resultado |
| --- | --- | --- |
| Tipos (TypeScript) | `npm run typecheck` | ✅ sem erros |
| Integração (regras de negócio + PostgreSQL real) | Vitest, `npm test` | ✅ 90/90 |
| Ponta a ponta (navegador de celular + app de produção + simulador do Mercado Pago) | Playwright, `npm run test:e2e` | ✅ 28/28 |
| Build de produção | `npm run build` | ✅ |

**Importante:** os testes de pagamento usam um **simulador local** do Mercado Pago (`tests/mock-mp/server.mjs`), que imita a API e envia webhooks assinados. O ambiente onde o projeto foi construído **não tem acesso à rede do Mercado Pago**, então **não houve teste contra o sandbox nem contra a produção do Mercado Pago**. Isso precisa ser feito antes de abrir as vendas (roteiro na seção 7 do README).

## Testes obrigatórios (item 15 do pedido)

| # | Cenário | Como foi verificado | Status |
| --- | --- | --- | --- |
| 1 | Compra de ingresso feminino | Integração (preço 20,00 + taxa 3,00 = 23,00) e navegador (Pix completo) | ✅ (simulador) |
| 2 | Compra de ingresso masculino | Integração (30,00 + 3,00 = 33,00) e navegador (cartão completo) | ✅ (simulador) |
| 3 | Cálculo correto dos preços | Integração: preço/taxa vindos do banco; alteração de preço vale para novas compras | ✅ |
| 4 | Validação dos campos obrigatórios | Navegador (mensagens na tela) e integração (nome vazio, só espaços, sem sobrenome, com símbolos; celular ausente ou com letras) | ✅ |
| 5 | Bloqueio de menores de 18 anos | Navegador (não avança sem marcar) e API (400 com `adultConfirmed: false`) | ✅ |
| 6 | Pagamento por Pix | Navegador: Pix escolhido → checkout do Mercado Pago só com Pix (cartão excluído, Pix permitido) → pendente → aprovado; chave de idempotência `pref-<compra>` enviada | ✅ (simulador) |
| 7 | Pagamento por cartão | Navegador: redirecionamento ao checkout, parcela única, taxa como item separado, retorno aprovado | ✅ (simulador) |
| 8 | Pagamento aprovado | Confirma, gera código interno, entra na lista oficial | ✅ |
| 9 | Pagamento pendente | Permanece "aguardando", não conta como receita nem entra na lista | ✅ |
| 10 | Pagamento recusado | Pix ou cartão recusado → compra segue pendente, nada entra na lista e o comprador pode tentar de novo até a reserva vencer | ✅ |
| 11 | Webhook recebido mais de uma vez | 3 webhooks iguais → 1 confirmação, 1 ingresso, 1 registro de pagamento; 5 aplicações simultâneas → 1 confirmação | ✅ |
| 12 | Usuário fecha o navegador | Navegador fechado depois de gerar o Pix no Mercado Pago → webhook confirma; também conciliação sem webhook | ✅ |
| 13 | Falsificar o preço | Campos `amountCents`/`priceCents` enviados à API são ignorados; MP recebe o valor do banco; pagamento com valor diferente não confirma | ✅ |
| 14 | Painel sem autenticação | Páginas redirecionam ao login; exportação retorna 401; senha errada retorna 401 | ✅ |
| 15 | Pesquisa por nome | Busca "otavio" encontra "Otávio Mendes Luz" (sem acento/maiúsculas) | ✅ |
| 16 | Duas entradas para o mesmo ingresso | **Não se aplica**: por decisão da organização não há portal de portaria; a entrada é controlada na lista impressa (caixinha "Entrou"). O banco impede ingresso duplicado (`ticket_code` e `mp_payment_id` únicos). | — |
| 17 | Exportação da lista | CSV com BOM UTF-8, `;`, acentos corretos, só confirmados; proteção contra fórmulas | ✅ |
| 18 | Fechamento das vendas | Página mostra "Vendas fechadas"; API retorna 409; painel fecha/abre e impede abrir com pendências | ✅ |
| 19 | Limite de lotação | 10 compras simultâneas com lotação 3 → exatamente 3 reservas; reserva vencida libera vaga; aprovação tardia acima da lotação não entra na lista | ✅ |
| 20 | Dispositivos móveis | Todos os testes de navegador rodam em viewport de celular; sem rolagem horizontal; telas revisadas por captura (celular e desktop) | ✅ |

## Vários ingressos por pedido e ingressos manuais

| Cenário | Como foi verificado |
| --- | --- |
| Pedido de 3 ingressos (2 feminino + 1 masculino) com um único pagamento | Integração: itens do checkout (por categoria + taxa × 3), total R$ 79,00, todos confirmados com códigos diferentes |
| Pagamento com valor de 1 ingresso para pedido de 3 | Integração: não confirma, alerta de valor divergente |
| Estorno | Integração: devolve o pedido inteiro e tira todos da lista |
| Lotação | Integração: pedido maior que as vagas restantes é recusado; reserva vencida libera todas as vagas; aprovação tardia acima da lotação exige estorno |
| Clique duplo / mesma chave | Integração: 1 pedido com 3 linhas e 1 preferência no Mercado Pago; dados diferentes com a mesma chave são recusados |
| Limites | Integração e API: máximo de 10 por pedido, nomes repetidos, nome ou categoria inválidos |
| Telas | Navegador: adicionar/remover ingresso, mensagens por ingresso, resumo com taxa × quantidade, aprovação mostra todos os nomes |
| Ingresso manual (painel) | Integração e navegador: vários nomes de uma vez, valor padrão/personalizado/cortesia, sem taxa, entra na lista impressa e no CSV, ocupa vaga, remoção libera vaga, exige login, recusa lotação estourada, banco impede forma de pagamento online em ingresso manual |

**Não testado com o Mercado Pago real:** o checkout com `quantity` maior que 1 (taxa de serviço × N) segue o formato documentado da API de preferências, mas só foi exercitado no simulador local. Faça uma compra real de 2 ingressos antes de divulgar.

## Entrada por QR Code (portaria)

| Cenário | Como foi verificado |
| --- | --- |
| Interruptor lista ↔ QR Code | Navegador e integração: ativar exige código da portaria (só o hash scrypt é salvo); voltar para a lista desliga o leitor (página e APIs respondem "desativada") |
| Comprador recebe o QR | Navegador: pedido aprovado mostra um QR por ingresso com o código escrito; página individual do ingresso; no modo lista não aparece QR |
| Cada ingresso tem código próprio | Integração: pedido de vários ingressos e ingresso manual; pendente não tem código |
| Leitura pela câmera | Navegador com **câmera falsa do Chromium** exibindo o QR de um ingresso: o leitor encontra o QR sozinho, mostra o nome, confirma e, ao ler de novo, mostra "JÁ ENTROU" |
| QR gerado é legível | Integração: QR gerado pela biblioteca `qrcode` é lido de volta pela `jsqr` (a mesma do leitor) |
| Digitação do código | Navegador: código em minúsculas e com traços é aceito; código inexistente → "NÃO ENCONTRADO"; aparelho sem câmera mostra aviso e permite digitar |
| Uma entrada por QR | Integração: 5 confirmações simultâneas → 1 entrada; segunda leitura → "já entrou" com horário e quem confirmou |
| Ingresso estornado | Integração: leitor recusa e não registra entrada |
| Transferência | Integração: novo QR é gerado e o antigo passa a "não encontrado" |
| Acesso da portaria | Navegador: código errado é recusado; a sessão da portaria não abre o painel nem as APIs do painel; trocar o código desconecta o leitor |
| Painel | Navegador: contador de entradas, lista com quem confirmou e "Desfazer entrada" |
| Dados na portaria | Integração: o leitor recebe só nome, categoria, camarote/Atlética e horário de entrada (sem telefone nem valores) |

**Não testado:** leitura em iPhone/Android reais (o teste usa a câmera falsa do Chromium). Faça um teste no celular de quem vai ficar na porta antes da festa: abra `/portaria`, permita a câmera e leia o QR de um ingresso de teste.

## Outros testes

- Assinatura do webhook: válida, ID adulterado, segredo errado, cabeçalho ausente/malformado; webhook forjado retorna 401 e fica registrado na auditoria.
- CSRF: `POST /api/purchases` com `Origin` de outro site → 403.
- Clique duplo: 4 envios com a mesma chave → 1 compra e 1 preferência no Mercado Pago.
- Falha do Mercado Pago ao criar pagamento → compra "falhou", sem reserva presa, mensagem amigável.
- Estorno pelo painel → "estornado", sai da lista; chargeback também.
- Pagamento duplicado na mesma compra → alerta; estorno do excedente limpa o alerta.
- Nenhum e-mail é pedido ou gravado: o Pix também roda no Checkout Pro.
- Pix cancelado/vencido ou cartão recusado não encerram a compra: o comprador pode tentar de novo até a reserva vencer; depois vira "expirado".
- Versão dos termos e data/hora do aceite registradas; aceite de versão antiga é recusado.
- Senhas: hash scrypt com sal, verificação, regras mínimas.
- Lista impressa conferida em PDF A4.
- Transferência de ingresso pelo painel: nome trocado na lista impressa, código interno mantido; compra pendente não pode ser transferida.
- Telefone de contato: formatos comuns aceitos; número com letra (ex.: "429l1374203") é recusado em vez de virar outro número.

## Limitações conhecidas / o que falta

1. **Teste com o Mercado Pago real (sandbox e produção) não realizado** — sem acesso de rede ao Mercado Pago neste ambiente. Os campos da API foram conferidos no SDK oficial `mercadopago` v3.6.1, mas é obrigatório fazer o roteiro do README (seção 7).
2. **Única pendência para vender**: credenciais do Mercado Pago (`MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`). Os dados do evento estão completos.
3. Migração `002_buyer_phone.sql` testada aplicando por cima de um banco já existente.
4. A política de privacidade é um modelo — revise com a diretoria.
5. Testes em iPhone/Safari reais não foram feitos (apenas Chromium com perfil de celular).
6. Os valores de custo (Mercado Pago, Railway) no README são referências e devem ser confirmados nos sites oficiais.

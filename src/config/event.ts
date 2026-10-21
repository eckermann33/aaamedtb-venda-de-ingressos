/**
 * CONFIGURAÇÃO INICIAL DO EVENTO
 *
 * Estes são os valores usados para criar a configuração no banco de dados na
 * primeira execução de `npm run db:migrate`. Depois disso, tudo pode ser
 * alterado pelo painel em /admin/configuracoes (sem mexer no código).
 *
 * Campos com `null` são INFORMAÇÕES PENDENTES: ainda não foram fornecidas pela
 * organização e não devem ser inventadas. As vendas só podem ser abertas
 * depois que os campos obrigatórios forem preenchidos no painel.
 */

export type EventInfo = {
  name: string;
  tagline: string;
  organizer: string;
  organizerShort: string;
  partner: string | null;
  /** Data no formato AAAA-MM-DD. */
  date: string | null;
  /** Horário de início, ex.: "22:00". */
  startTime: string | null;
  endTime: string | null;
  venueName: string | null;
  venueAddress: string | null;
  ageRating: string;
  about: string;
  camarote: string;
  contactEmail: string | null;
  /** Telefone/WhatsApp da organização (somente dígitos, com DDD). */
  contactPhone: string | null;
  contactInstagram: string | null;
  /** Nome que aparece na fatura do cartão (até 13 caracteres). */
  statementDescriptor: string;
  /** Dias após o evento em que os nomes dos compradores devem ser anonimizados. */
  retentionDays: number;
};

export type TermsContent = {
  rules: string[];
  refundPolicy: string | null;
  cancellationPolicy: string | null;
  transferPolicy: string | null;
};

export const DEFAULT_EVENT: EventInfo = {
  name: "Party do Saco Cheio",
  tagline: "O semestre não acaba e as festas também não!",
  organizer: "Associação Atlética Acadêmica de Medicina de Telêmaco Borba — Invictus (A.A.A.MED.TB)",
  organizerShort: "Atlética Invictus",
  partner: "Santo Gole",
  date: "2026-10-24",
  startTime: "23:30",
  endTime: null, // PENDENTE (opcional)
  venueName: "Santo Gole",
  venueAddress: null, // opcional — endereço não informado
  ageRating: "Proibido para menores de 18 anos.",
  about:
    "A festa da Atlética Invictus em parceria com a Santo Gole. A entrada é feita pela lista oficial: depois que o pagamento é aprovado, seu nome completo entra na lista da portaria.",
  camarote:
    "O camarote será vendido separadamente na entrada da festa, conforme disponibilidade. A compra do ingresso comum não garante acesso ao camarote.",
  contactEmail: null, // opcional
  contactPhone: "42991374203",
  contactInstagram: null, // PENDENTE (opcional)
  statementDescriptor: "INVICTUS",
  retentionDays: 90,
};

export const DEFAULT_TERMS: TermsContent = {
  rules: [
    "A entrada é permitida exclusivamente para maiores de 18 anos.",
    "Poderá ser exigido documento oficial com foto para verificar a identidade e a idade do participante.",
    "É proibida a entrada com bebidas externas.",
    "É proibida a entrada com armas, objetos cortantes, perfurantes ou outros objetos que representem risco à segurança.",
    "Não será permitida a entrada de objetos ou substâncias proibidos pela legislação ou pelas regras de segurança do evento.",
    "O camarote será vendido separadamente na entrada da festa, conforme disponibilidade.",
    "A compra do ingresso comum não garante acesso ao camarote.",
  ],
  refundPolicy:
    "Depois que o pagamento é aprovado, a compra não pode ser cancelada pelo comprador e o valor não é reembolsado, ressalvados os direitos previstos no Código de Defesa do Consumidor.",
  cancellationPolicy:
    "Se a festa for cancelada, a organização entrará em contato com quem comprou pelo telefone/WhatsApp informado na compra.",
  transferPolicy:
    "O ingresso pode ser transferido para outra pessoa maior de 18 anos. Para isso, envie uma mensagem para o telefone/WhatsApp de contato da organização informando o nome completo de quem comprou e o nome completo da nova pessoa. A organização atualiza o nome na lista oficial de entrada.",
};

export const DEFAULT_CATEGORIES = [
  { id: "feminino", label: "Feminino", priceCents: 2000, sortOrder: 1 },
  { id: "masculino", label: "Masculino", priceCents: 3000, sortOrder: 2 },
];

/**
 * Limite de ingressos vendidos online (confirmados + reservas em pagamento).
 * Informado pela organização: a festa não passa de 500 pessoas. Se houver venda na
 * porta (ex.: camarote) ou convidados, reduza este número no painel.
 */
export const DEFAULT_CAPACITY = 500;

/** Taxa de serviço por ingresso (em centavos). Alterável no painel. */
export const DEFAULT_SERVICE_FEE_CENTS = 300;

/** Tempo que o comprador tem para pagar (o checkout do Mercado Pago expira junto). */
export const PAYMENT_WINDOW_MINUTES = 30;

/** A vaga fica reservada um pouco além do prazo, para absorver atrasos de notificação. */
export const RESERVATION_GRACE_MINUTES = 5;

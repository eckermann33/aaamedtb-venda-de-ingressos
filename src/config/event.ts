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
  /** Título da página inicial em duas partes: linha menor e linha de destaque (ex.: "Chopada" / "Final"). */
  titleTop?: string | null;
  titleMain?: string | null;
  /** Cartaz da festa: arquivo em public/images (ex.: "/images/cartaz-chopada-final.webp"). */
  poster?: string | null;
  /** Cor de destaque do site, combinando com o cartaz (ex.: "#a63cff"). Vazio = só o verde da Invictus. */
  accent?: string | null;
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
  name: "Chopada Final da Invictus",
  titleTop: "Chopada",
  titleMain: "Final",
  poster: "/images/cartaz-chopada-final.webp",
  accent: "#a63cff",
  tagline: "Open chop · Beer pong · DJ HS",
  organizer: "Associação Atlética Acadêmica de Medicina de Telêmaco Borba — Invictus (A.A.A.MED.TB)",
  organizerShort: "Atlética Invictus",
  partner: "QG Conveniência",
  date: "2026-11-21",
  startTime: null, // PENDENTE
  endTime: null, // PENDENTE (opcional)
  venueName: "Sítio Contatto",
  venueAddress: null, // opcional
  ageRating: "Proibido para menores de 18 anos.",
  about:
    "A Chopada Final da Invictus é no Sítio Contatto, com open chop, beer pong e atração confirmada DJ HS. Organização: QG Conveniência. Apenas 1 lote de pulseiras! Universitários pagam preço especial apresentando a carteira de estudante na entrada.",
  camarote: "", // vazio = a seção de camarote não aparece no site
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
    "Pulseira universitária (preço especial): na entrada é obrigatório apresentar a carteira de estudante. Quem não apresentar paga a diferença para o preço cheio (pulseira geral).",
    "A pulseira universitária feminina é destinada a pessoas do gênero feminino; na portaria o documento com foto poderá ser conferido.",
    "Open chop: bebida alcoólica servida somente para maiores de 18 anos.",
    "É proibida a entrada com bebidas externas.",
    "É proibida a entrada com armas, objetos cortantes, perfurantes ou outros objetos que representem risco à segurança.",
    "Não será permitida a entrada de objetos ou substâncias proibidos pela legislação ou pelas regras de segurança do evento.",
    "O descumprimento das regras acima poderá gerar cobrança adicional na entrada da festa.",
  ],
  refundPolicy:
    "Depois que o pagamento é aprovado, a compra não pode ser cancelada pelo comprador e o valor não é reembolsado, ressalvados os direitos previstos no Código de Defesa do Consumidor.",
  cancellationPolicy:
    "Se a festa for cancelada, a organização entrará em contato com quem comprou pelo telefone/WhatsApp informado na compra.",
  transferPolicy:
    "O ingresso pode ser transferido para outra pessoa maior de 18 anos. Para isso, envie uma mensagem para o telefone/WhatsApp de contato da organização informando o nome completo de quem comprou e o nome completo da nova pessoa. A organização atualiza o nome na lista oficial de entrada.",
};

export const DEFAULT_CATEGORIES: {
  id: string;
  label: string;
  priceCents: number;
  sortOrder: number;
  description: string | null;
}[] = [
  {
    id: "universitaria-feminina",
    label: "Universitária feminina",
    priceCents: 4500,
    sortOrder: 1,
    description: "Com carteira de estudante na entrada. Para o público feminino.",
  },
  {
    id: "universitario-masculino",
    label: "Universitário masculino",
    priceCents: 5500,
    sortOrder: 2,
    description: "Com carteira de estudante na entrada.",
  },
  {
    id: "geral",
    label: "Geral (não universitário)",
    priceCents: 7500,
    sortOrder: 3,
    description: "Preço cheio, para quem não é universitário.",
  },
];

/**
 * Limite de ingressos vendidos online (confirmados + reservas em pagamento).
 * Informado pela organização: a festa não passa de 500 pessoas. Se houver venda na
 * porta (ex.: camarote) ou convidados, reduza este número no painel.
 */
export const DEFAULT_CAPACITY = 500;

/**
 * Taxa de serviço cobrada POR INGRESSO (em centavos): um pedido com 3 ingressos paga 3 taxas.
 * Alterável no painel; também é a sugestão do formulário "Começar nova festa".
 */
export const DEFAULT_SERVICE_FEE_CENTS = 500;

/** Máximo de ingressos (pessoas) em um único pedido. */
export const MAX_TICKETS_PER_ORDER = 10;

/** Tempo que o comprador tem para pagar (o checkout do Mercado Pago expira junto). */
export const PAYMENT_WINDOW_MINUTES = 30;

/** A vaga fica reservada um pouco além do prazo, para absorver atrasos de notificação. */
export const RESERVATION_GRACE_MINUTES = 5;

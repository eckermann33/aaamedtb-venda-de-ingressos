import type { EventInfo } from "@/config/event";

export function phoneDigits(raw: string | null | undefined): string | null {
  // Letras ou outros símbolos invalidam o número (evita aceitar "429l1374203" como outro telefone).
  if (!raw || !/^[\d\s().+-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

/** Formata 42999998888 como (42) 99999-8888. */
export function formatPhone(digits: string): string {
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
}

export type ContactLink = { label: string; href: string };

/** Formas de contato da organização exibidas no site (WhatsApp, e-mail). */
export function contactLinks(event: Pick<EventInfo, "contactPhone" | "contactEmail">): ContactLink[] {
  const links: ContactLink[] = [];
  const phone = phoneDigits(event.contactPhone);
  if (phone) links.push({ label: `WhatsApp ${formatPhone(phone)}`, href: `https://wa.me/55${phone}` });
  if (event.contactEmail) links.push({ label: event.contactEmail, href: `mailto:${event.contactEmail}` });
  return links;
}

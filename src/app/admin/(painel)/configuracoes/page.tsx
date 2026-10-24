import { getSql } from "@/server/db";
import { envState } from "@/server/deps";
import { loadSettings, readiness } from "@/server/settings";
import { AnonymizeAll } from "../actions";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const settings = await loadSettings(getSql());
  const pending = readiness(settings, envState()).filter((i) => i.blocking);
  return (
    <>
      <h1 className="admin-title">Configurações</h1>
      <p className="admin-sub">
        Alterações de preço e taxa valem para as próximas compras. Mudanças nas regras/políticas criam uma nova versão
        dos termos (compras antigas mantêm a versão aceita).
      </p>
      <SettingsForm
        initial={{
          event: settings.event,
          capacity: settings.capacity,
          serviceFeeCents: settings.serviceFeeCents,
          terms: settings.terms,
          categories: settings.categories,
        }}
        pending={pending.map((p) => p.key)}
      />
      <div className="panel" style={{ marginTop: 32 }}>
        <h2>Retenção de dados (LGPD)</h2>
        <p className="hint">
          Política configurada: anonimizar os nomes em até {settings.event.retentionDays} dias após o evento. Exporte a
          lista/compras antes, se precisar guardar para prestação de contas. Valores e IDs de pagamento são mantidos.
        </p>
        <AnonymizeAll />
      </div>
    </>
  );
}

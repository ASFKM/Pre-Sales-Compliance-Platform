import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// AUD-011 (auditoria de segurança, 2026-07-19): várias tabelas têm tenantId E uma FK pra outro
// modelo tenant-scoped (ex.: Document.projectId -> Project), mas nada no BANCO garante que os dois
// tenantId batem - só a extensão Prisma de escopo (src/prisma.ts) garante isso em toda escrita
// NOVA feita através dela. Rodado uma vez em 2026-07-19 contra o banco real: zero inconsistências
// encontradas em nenhuma das tabelas abaixo - o risco é preventivo, não uma exploração confirmada.
//
// Decisão consciente: NÃO adicionar constraints de FK compostas (id, tenant_id) no schema agora.
// Isso exigiria um índice único composto em cada tabela pai e alterar toda FK filha pra referenciá-
// lo - uma migration estrutural extensa (dezenas de tabelas/relações), com risco real de lock de
// tabela e falha se algum dado histórico tiver duplicidade, pra fechar um risco hoje puramente
// teórico. Este script é a mitigação proporcional: detecção rápida se uma inconsistência real
// aparecer no futuro (rodar manualmente ou via cron/health check), não prevenção estrutural.
//
// Cobertura representativa (as relações tenant+FK mais expostas via API), não exaustiva de todo o
// schema - estender esta lista é seguro e direto se novas relações desse tipo forem adicionadas.
const raw = new PrismaClient();

interface Check {
  label: string;
  sql: string;
}

const CHECKS: Check[] = [
  { label: "Document -> Project", sql: `SELECT COUNT(*)::int as count FROM documents d JOIN projects p ON d.project_id = p.id WHERE d.tenant_id != p.tenant_id` },
  { label: "AIAnalysisJob -> Project", sql: `SELECT COUNT(*)::int as count FROM analysis_jobs j JOIN projects p ON j.project_id = p.id WHERE j.tenant_id != p.tenant_id` },
  { label: "AnalysisResult -> Project", sql: `SELECT COUNT(*)::int as count FROM analysis_results r JOIN projects p ON r.project_id = p.id WHERE r.tenant_id != p.tenant_id` },
  { label: "ConversationMessage -> Project", sql: `SELECT COUNT(*)::int as count FROM conversation_messages c JOIN projects p ON c.project_id = p.id WHERE c.tenant_id != p.tenant_id` },
  { label: "Proposal -> Project", sql: `SELECT COUNT(*)::int as count FROM proposals pr JOIN projects p ON pr.project_id = p.id WHERE pr.tenant_id != p.tenant_id` },
  { label: "User -> Role", sql: `SELECT COUNT(*)::int as count FROM users u JOIN roles r ON u.role_id = r.id WHERE u.tenant_id != r.tenant_id` },
  { label: "ProjectPricingSheet -> Project", sql: `SELECT COUNT(*)::int as count FROM project_pricing_sheets s JOIN projects p ON s.project_id = p.id WHERE s.tenant_id != p.tenant_id` },
];

async function main() {
  console.log("=== Verificação de consistência tenant/recurso (AUD-011) ===\n");
  let anyMismatch = false;

  for (const check of CHECKS) {
    const rows = await raw.$queryRawUnsafe<{ count: number }[]>(check.sql);
    const count = rows[0].count;
    const status = count === 0 ? "OK" : "INCONSISTÊNCIA ENCONTRADA";
    console.log(`[${status}] ${check.label}: ${count}`);
    if (count > 0) anyMismatch = true;
  }

  console.log("");
  if (anyMismatch) {
    console.error("Alguma inconsistência real foi encontrada - investigar antes de qualquer decisão de constraint de banco.");
    process.exitCode = 1;
  } else {
    console.log("Nenhuma inconsistência encontrada.");
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => raw.$disconnect());

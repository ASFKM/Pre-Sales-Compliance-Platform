/*
 * F5 — desativa os templates de proposta ATIVOS cujo arquivo físico não existe.
 *
 * Por que um script e não a migration: a migration é SQL e não enxerga o armazenamento. O
 * critério certo ("o arquivo está lá?") depende do adaptador de storage — que pode ser local,
 * S3 ou GCS —, e qualquer tentativa de adivinhá-lo pelo formato do `file_path` seria uma
 * heurística que acerta neste banco e erra no próximo. Este script usa a MESMA checagem que o
 * runtime faz antes de gerar a proposta (createStorageAdapter(...).exists), então o resultado
 * é exato em qualquer instalação.
 *
 * Por que desativar em vez de deixar quebrar na hora da geração: a partir da F5 o template com
 * arquivo é obrigatório, e `resolveRegisteredTemplate` já recusa template inativo com mensagem
 * própria. Deixá-los ativos significaria oferecê-los no seletor de templates para que a pessoa
 * escolha algo que só vai falhar depois. Desativar é reversível: reenviar o arquivo pelo
 * cadastro de templates e reativar devolve o modelo ao ar, sem perder o registro nem o
 * histórico das propostas que já saíram por ele.
 *
 * Uso:  npx tsx scripts/f5-desativar-templates-sem-arquivo.ts [--aplicar]
 *       Sem --aplicar, só relata (dry-run).
 */
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { createStorageAdapter } from "../server/utils/storage";

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  let semArquivo = 0;

  for (const tenant of tenants) {
    await runWithTenant({ tenantId: tenant.id }, async () => {
      const settings = await prisma.platformSettings.findFirst();
      if (!settings) return;
      const templates = await prisma.proposalTemplate.findMany({ where: { active: true } });

      for (const t of templates) {
        let existe = false;
        try {
          const adapter = createStorageAdapter({ ...(settings as any), storage_mode: t.storageProvider });
          existe = await adapter.exists(t.filePath);
        } catch {
          existe = false;
        }
        if (existe) continue;

        semArquivo++;
        console.log(`[sem arquivo] ${tenant.name} :: ${t.id} :: ${t.name} :: ${t.filePath}`);
        if (aplicar) {
          await prisma.proposalTemplate.update({ where: { id: t.id }, data: { active: false } });
          console.log(`             -> desativado`);
        }
      }
    });
  }

  console.log(`\n${semArquivo} template(s) ativo(s) sem arquivo físico.`);
  console.log(aplicar ? "Desativados." : "Dry-run: rode com --aplicar para desativar.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

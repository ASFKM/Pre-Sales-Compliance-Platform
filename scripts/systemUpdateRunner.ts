// CLI entrypoint scripts/update.sh calls at each lifecycle transition (progress step, success,
// failure, rollback outcome) - kept as a separate file from server/utils/updateScheduler.ts
// specifically so it can import BOTH updateScheduler.ts (DB state transitions) and
// fleetLicense.ts (to fire an immediate out-of-band heartbeat on failure) without creating a
// circular import between those two modules. Run via `npx tsx scripts/systemUpdateRunner.ts <subcommand> [--flags]`.
import fs from "fs";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { dbStore } from "../src/dbStore";
import { markAttemptFailed, markAttemptSucceeded } from "../server/utils/updateScheduler";
import { runHeartbeatForTenant } from "../server/utils/fleetLicense";
import { logger } from "../server/utils/logger";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value !== undefined) args[key] = value;
  }
  return args;
}

function readErrorLog(filePath: string | undefined): string {
  if (!filePath) return "(nenhum log de erro capturado)";
  try {
    // Bounded read - a runaway build/migration log must not blow up the error_log column or the
    // heartbeat payload this eventually rides in.
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.length > 20000 ? `${raw.slice(-20000)}\n\n[log truncado - mostrando os últimos 20000 caracteres]` : raw;
  } catch (err) {
    return `(falha ao ler o arquivo de log ${filePath}: ${err})`;
  }
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const tenantId = args["tenant-id"];
  if (!tenantId) {
    console.error("--tenant-id é obrigatório");
    process.exit(1);
  }

  await runWithTenant({ tenantId }, async () => {
    switch (subcommand) {
      case "step": {
        if (args["task-id"]) {
          await prisma.backgroundTask.update({ where: { id: args["task-id"] }, data: { currentStep: args["message"] || "" } });
        }
        break;
      }
      case "success": {
        await markAttemptSucceeded(tenantId, { historyId: args["history-id"], taskId: args["task-id"], backupRef: args["backup-ref"] });
        logger.warn({ tenantId }, "Atualização do sistema concluída com sucesso");
        break;
      }
      case "failed":
      case "rolled_back": {
        const errorLog = readErrorLog(args["error-log-file"]);
        await markAttemptFailed(tenantId, errorLog, {
          historyId: args["history-id"],
          taskId: args["task-id"],
          rolledBack: subcommand === "rolled_back",
        });
        // Immediate out-of-band heartbeat (decisão já confirmada: enviar log de erro ao CMSaaS
        // para análise) instead of waiting up to 20 minutes for the next scheduled one - the
        // error log rides up in the regular `logs` array the heartbeat already sends, tagged so
        // an admin reviewing that installation's logs on the CMSaaS side can filter to it.
        await dbStore.addDebugLog({
          log_level: "ERROR",
          service_name: "commercial-assistant-ai",
          module_name: "system_update",
          environment: process.env.NODE_ENV || "production",
          correlation_id: `system_update:${args["history-id"] || tenantId}`,
          request_id: `system_update:${args["history-id"] || tenantId}`,
          tenant_id: tenantId,
          operation: "system_update",
          message: `Atualização do sistema ${subcommand === "rolled_back" ? "revertida (rollback automático)" : "falhou"}: ${errorLog.slice(0, 2000)}`,
          status: "error",
          duration_ms: 0,
          safe_metadata: "{}",
        }).catch((err) => logger.warn({ err, tenantId }, "Failed to write system_update debug log entry"));
        await runHeartbeatForTenant(tenantId).catch((err) => logger.error({ err, tenantId }, "Failed to send immediate out-of-band heartbeat after update failure"));
        break;
      }
      default:
        console.error(`Subcomando desconhecido: ${subcommand}`);
        process.exit(1);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "systemUpdateRunner falhou");
    process.exit(1);
  });

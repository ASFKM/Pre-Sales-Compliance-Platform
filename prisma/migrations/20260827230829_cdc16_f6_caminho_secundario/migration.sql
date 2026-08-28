-- CDC 16 — Fase 6. O CAMINHO SECUNDÁRIO (D12/D13): o pré-vendas sobe um edital direto, procura a
-- empresa no CRM, cria a que não existia e cria a oportunidade lá.
--
-- Aditiva por inteiro, e é o que permite publicar com o serviço no ar: um enum novo, uma coluna
-- anulável, uma coluna com default, e dois NOT NULL AFROUXADOS. Nenhum UPDATE, nenhum default que
-- reescreva linha existente. Afrouxar um NOT NULL é seguro com o bundle antigo servindo, porque o
-- código antigo sempre escreve aqueles dois campos — o que muda é o que passa a ser aceito, não o
-- que passa a ser exigido.
--
-- `crm_pair_keys.crm_organization_id`: QUAL organização do CRM este par escreve. A chave do par
-- resolve o par, e o par diz qual INSTALAÇÃO do CMCRM — mas uma instalação hospeda muitas
-- organizações (521 na do dia em que esta fase abriu) e os três caminhos novos não têm `demand_ref`
-- de onde derivar a certa. Nulo até alguém usar o caminho secundário, que é o estado de toda
-- instalação que existe hoje.
--
-- `demands.source` e os dois NOT NULL: a demanda ESPELHO. Ela existe para dar `demand_ref` a um
-- projeto que nasceu AQUI, e é esse `demand_ref` que faz o retorno da F3/F4/F5 ter para onde
-- chegar. Nela não houve envio nenhum do lado do CRM, então `sent_by_crm_user_id` e `sent_by_name`
-- são nulos por construção — preenchê-los com um marcador diria à tela do vendedor que alguém
-- enviou o que ninguém enviou, e envenenaria a medição de tempo de resposta (D20), que conta a
-- partir do envio.

-- CreateEnum
CREATE TYPE "DemandSource" AS ENUM ('crm', 'presales');

-- AlterTable
ALTER TABLE "crm_pair_keys" ADD COLUMN     "crm_organization_id" TEXT;

-- AlterTable
ALTER TABLE "demands" ADD COLUMN     "source" "DemandSource" NOT NULL DEFAULT 'crm',
ALTER COLUMN "sent_by_crm_user_id" DROP NOT NULL,
ALTER COLUMN "sent_by_name" DROP NOT NULL;

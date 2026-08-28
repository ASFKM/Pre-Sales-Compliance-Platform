-- CDC 16 — Fase 10. O card "Tarefas Pendentes do Usuário" sai de vez, e a
-- tabela dele sai junto (resposta C do dono na F8: "remover por completo").
--
-- Por que a remoção é do BANCO e não só da tela. O pedido original do dono
-- dizia que aquele card "não estava ligado a nada"; a medição da F8 mostrou o
-- contrário — ele tinha rota (`/api/user-tasks`), tinha esta tabela e havia
-- substituído um `localStorage`. Dizer isso era a função daquela fase. O que
-- tornou a decisão barata foi o outro número, medido no Demo publicado em
-- 28/08/2026, antes de escrever esta linha:
--
--     select count(*), count(distinct owner_user_id), count(project_id) from tasks;
--      0 | 0 | 0
--
-- Zero tarefas, zero donos, zero ligadas a projeto. Não há dado de ninguém aqui.
--
-- Os dois ENUMS saem junto porque a tabela era a única a declará-los (medido no
-- schema: `TaskStatus` e `Priority` não aparecem em nenhum outro model). Deixar
-- tipo aposentado vivo no Postgres é a dívida que o `ia_kb` já criou nesta casa
-- uma vez, e ela custa mais de pagar depois do que agora.
DROP TABLE IF EXISTS "tasks";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "Priority";

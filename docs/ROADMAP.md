# Roadmap Técnico - Pre-Sales Compliance Platform

> **SUPERSEDIDO (2026-07-05)**: as seções de roadmap futuro abaixo (Subscrição e Licença,
> Observabilidade/Logs/Debug) foram incorporadas e expandidas no redesenho completo em
> [`docs/roadmap/REDESIGN_ROADMAP_2026-07.md`](./roadmap/REDESIGN_ROADMAP_2026-07.md), que é a
> fonte de verdade atual para todo planejamento em andamento (8 fases, decisões técnicas e status
> de cada uma). Este arquivo é mantido só por histórico.

## Status atual

A plataforma já possui os principais módulos administrativos funcionais:

- Usuários e acessos
- Perfis e permissões
- Configurações de IA e prompts (multi-provedor: Anthropic, OpenAI, Google, por tipo de tarefa)
- Templates de propostas (7 tipos ponta a ponta, incl. Técnico-Comercial) e glossário de 32 variáveis
- Base de Conhecimento e enriquecimento de BOM (aprovação humana, busca web como fallback)
- Fluxos de aprovação
- Identidade visual / branding
- Integrações e conectores
- Armazenamento e documentos (local, S3, GCS)
- Auditoria e diagnóstico básico

---

## Roadmap futuro: Subscrição e Licença

A seção de Subscrição e Licença deve permanecer fora do escopo funcional imediato.

### Motivo

Licenciamento não deve ser tratado apenas como uma chave digitada no frontend. Para ser confiável, precisa de desenho próprio de produto, segurança, modelo comercial e validação técnica.

### Escopo futuro recomendado

- Modelo de planos:
  - Free
  - Professional
  - Enterprise
  - On-premises
  - Trial
- Persistência backend da licença ativa
- Validação de chave no backend
- Assinatura criptográfica da licença
- Expiração e renovação
- Limites por plano:
  - usuários
  - projetos
  - documentos
  - análises de IA
  - propostas geradas
  - integrações ativas
  - armazenamento
- Modo offline para appliance on-premises
- Grace period após expiração
- Auditoria de ativação, renovação e violação de limites
- Tela administrativa com uso contratado versus uso real
- Política de bloqueio progressivo, sem perda de dados
- Possível integração futura com billing externo

### Decisão atual

Manter como item de roadmap. Não implementar MVP simplificado agora.

---

## Roadmap futuro: Observabilidade, Logs e Debug Avançado

A plataforma já possui auditoria, debug logs, exportação CSV e pacote de diagnóstico sanitizado.

### Motivo para deixar expansão no roadmap

Observabilidade completa exige política de retenção, segurança, privacidade, mascaramento, integração externa e governança operacional.

### Escopo futuro recomendado

- Retenção configurável de logs
- Filtros avançados por:
  - usuário
  - projeto
  - módulo
  - severidade
  - correlation ID
  - período
  - tipo de entidade
- Busca full-text em logs
- Dashboard de saúde do sistema
- Métricas de latência por endpoint
- Métricas de custo e consumo de IA
- Exportação JSON além de CSV/TXT
- Pacote diagnóstico com manifesto de integridade
- Redação/sanitização configurável de campos sensíveis
- Integração com SIEM ou webhook externo
- Alertas operacionais
- Separação entre auditoria de compliance e debug técnico
- Permissões granulares para visualização/exportação
- Assinatura do pacote diagnóstico
- Política de suporte remoto seguro

### Decisão atual

Manter o básico funcional já implementado. Evolução avançada fica no roadmap.

---

## Prioridades recomendadas para próximas fases

1. Fortalecer o fluxo principal de Workspace e Documentos.
2. Melhorar análise de documentos e extração de conteúdo.
3. Refinar geração de propostas técnicas/comerciais.
4. Melhorar tarefas, pendências e acompanhamento operacional.
5. Depois retornar para licenciamento e observabilidade avançada.

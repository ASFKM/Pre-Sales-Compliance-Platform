-- Adds the knowledge_base_analysis background task type, used by the "Analisar Documentos e
-- Gerar Base de Conhecimento" job - kept separate from document_analysis so the frontend's
-- per-project analysis-progress indicators never pick up a knowledge-base-wide job by mistake.
ALTER TYPE "BackgroundTaskType" ADD VALUE IF NOT EXISTS 'knowledge_base_analysis';

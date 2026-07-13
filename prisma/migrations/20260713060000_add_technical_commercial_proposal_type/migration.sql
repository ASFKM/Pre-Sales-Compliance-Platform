-- Adds the new proposal/template type "technical_commercial" (fusion of technical + commercial
-- into one document) plus wires the 4 previously-unreachable template types (executive_summary,
-- risk_report, bom_report, questions_report) into ProposalType so a Proposal row can actually be
-- created with any of these types too, not just ProposalTemplateType.
ALTER TYPE "ProposalTemplateType" ADD VALUE IF NOT EXISTS 'technical_commercial';
ALTER TYPE "ProposalType" ADD VALUE IF NOT EXISTS 'technical_commercial';
ALTER TYPE "ProposalType" ADD VALUE IF NOT EXISTS 'executive_summary';
ALTER TYPE "ProposalType" ADD VALUE IF NOT EXISTS 'risk_report';
ALTER TYPE "ProposalType" ADD VALUE IF NOT EXISTS 'bom_report';
ALTER TYPE "ProposalType" ADD VALUE IF NOT EXISTS 'questions_report';

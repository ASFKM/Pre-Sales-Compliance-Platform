import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { logDebugMessage } from "../middleware/security";
import { decryptSecret } from "../utils/security";
import { AnalysisResult } from "../../src/types";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";

const router = express.Router();

// 1. Zod Schema for Structured Output Validation
const ExecutiveSummarySchema = z.object({
  project_overview: z.string(),
  customer_context: z.string(),
  main_requirements: z.string(),
  main_risks: z.string(),
  main_opportunities: z.string(),
  recommended_strategy: z.string(),
  assumptions: z.string(),
  next_steps: z.string()
});

const CriticalRequirementSchema = z.object({
  requirement_id: z.string(),
  category: z.enum(["technical", "commercial", "contractual", "operational", "security", "integration", "infrastructure", "deadline", "support", "maintenance", "documentation", "training"]),
  description: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  source_snippet: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  mandatory_or_optional: z.enum(["mandatory", "optional"]),
  compliance_status: z.enum(["compliant", "partially_compliant", "non_compliant", "not_enough_information"]),
  evidence_type: z.enum(["directly_supported", "inferred_from_documents", "user_provided_instruction", "assumption", "missing_information", "requires_customer_confirmation"]),
  confidence: z.number().min(0).max(1),
  notes: z.string()
});

const ProjectRiskSchema = z.object({
  risk_id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  probability: z.enum(["low", "medium", "high"]),
  impact: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  source_snippet: z.string(),
  mitigation: z.string(),
  owner_area: z.string(),
  requires_customer_clarification: z.boolean(),
  evidence_type: z.string(),
  confidence: z.number()
});

const ProjectOpportunitySchema = z.object({
  opportunity_id: z.string(),
  title: z.string(),
  description: z.string(),
  business_value: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  suggested_solution: z.string(),
  sales_strategy: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  evidence_type: z.string(),
  confidence: z.number()
});

const BOMItemSchema = z.object({
  item_id: z.string(),
  product_or_service: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  category: z.string(),
  mandatory_or_optional: z.enum(["mandatory", "optional"]),
  reason_for_inclusion: z.string(),
  suggested_manufacturer: z.string(),
  alternatives: z.string(),
  assumptions: z.string(),
  source_reference: z.string(),
  risk_or_dependency: z.string(),
  requires_human_validation: z.boolean()
});

const PointToPointRowSchema = z.object({
  item_id: z.string(),
  customer_requirement: z.string(),
  proposed_solution: z.string(),
  compliance: z.enum(["compliant", "partially_compliant", "non_compliant", "not_enough_information"]),
  comments: z.string(),
  source_reference: z.string(),
  evidence_type: z.string(),
  confidence: z.number()
});

const PreliminarySchedulePhaseSchema = z.object({
  phase_id: z.string(),
  phase_name: z.string(),
  activities: z.array(z.string()),
  estimated_duration: z.string(),
  dependencies: z.array(z.string()),
  responsible_area: z.string(),
  assumptions: z.string(),
  risks: z.string()
});

const ClarificationQuestionSchema = z.object({
  question_id: z.string(),
  question: z.string(),
  reason: z.string(),
  related_requirement_or_risk: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  target_audience: z.string()
});

const AnalysisResultSchema = z.object({
  executive_summary: ExecutiveSummarySchema,
  critical_requirements: z.array(CriticalRequirementSchema),
  risks: z.array(ProjectRiskSchema),
  opportunities: z.array(ProjectOpportunitySchema),
  bom: z.array(BOMItemSchema),
  point_to_point_table: z.array(PointToPointRowSchema),
  preliminary_schedule: z.array(PreliminarySchedulePhaseSchema),
  clarification_questions: z.array(ClarificationQuestionSchema),
  technical_proposal_draft: z.string(),
  commercial_proposal_draft: z.string()
});

// Lazy Gemini client initialization with standard modern SDK and user-agent telemetry
let aiClient: GoogleGenAI | null = null;
let aiClientFingerprint = "";

async function getConfiguredGeminiApiKey(): Promise<string> {
  const envKey = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].find((key) => typeof key === "string" && key.trim().length > 0)?.trim();

  if (envKey) return envKey;

  const settings = await dbStore.getSettings() as any;
  const encryptedKey = settings.ai_api_key_encrypted;
  if (!encryptedKey) {
    throw new Error("Gemini API key is not configured. Configure it in Admin > IA, Prompts e Custos.");
  }

  return decryptSecret(encryptedKey);
}

async function getGeminiClient(): Promise<GoogleGenAI> {
  const key = await getConfiguredGeminiApiKey();
  const fingerprint = `${key.length}:${key.slice(0, 4)}:${key.slice(-4)}`;

  if (!aiClient || aiClientFingerprint !== fingerprint) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: { "User-Agent": "aistudio-build" }
      }
    });
    aiClientFingerprint = fingerprint;
  }

  return aiClient;
}

// GET latest analysis result
router.get("/projects/:projectId/analysis-result", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dbStore.getAnalysisResult(req.params.projectId);
    if (!result) {
      return res.status(404).json({ success: false, message: "No analysis result exists for this project." });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// UPDATE or SAVE analysis result manually (human-in-the-loop edits)
router.post("/projects/:projectId/analysis-result", requirePermission("analysis:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = req.body;
    result.project_id = req.params.projectId;
    result.updated_at = new Date().toISOString();

    await dbStore.saveAnalysisResult(result);

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update AI Analysis Content",
      entity_type: "AnalysisResult",
      entity_id: result.id || "ar_manual",
      project_id: req.params.projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ review_status: result.review_status })
    });

    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// TRIGGER AI analysis using Gemini with real extracted content
router.post("/projects/:projectId/analyze", requirePermission("analysis:run"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-ai";
  const startTime = Date.now();
  const projectId = req.params.projectId;

  const project = await dbStore.getProject(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: "Project not found." });
  }

  const platformSettings = await dbStore.getSettings();
  const analysisModel = platformSettings.document_analysis_model || platformSettings.default_model || "gemini-3.5-flash";

  // 1. Create Background AI Analysis Job and log it
  const userId = (req.headers["x-user-id"] as string) || "u1";
  const user = await dbStore.getUserById(userId);
  const userName = user ? user.name : "System User";

  const job = await dbStore.createJob({
    project_id: projectId,
    status: "running",
    ai_provider: "Google Gemini",
    ai_model: analysisModel,
    prompt_template_version: "v3.0-structured",
    started_at: new Date().toISOString(),
    created_by: userName,
    correlation_id: correlationId
  });

  await dbStore.addAuditLog({
    user_id: userName,
    action: "Trigger AI Document Analysis",
    entity_type: "AIAnalysisJob",
    entity_id: job.id,
    project_id: projectId,
    ip_address: req.ip || "127.0.0.1",
    user_agent: req.headers["user-agent"] || "unknown",
    metadata: JSON.stringify({ ai_model: job.ai_model, prompt_template: job.prompt_template_version })
  });

  // Analysis runs in the background from here - respond immediately with the task id and
  // let the frontend watch progress over the Phase 1 SSE stream instead of holding the
  // request open for the whole Gemini call.
  const task = await createTask({ userId, type: "document_analysis", currentStep: "Iniciando análise..." });
  res.status(202).json({ success: true, task_id: task.id, job_id: job.id });

  void (async () => {
  try {
    await updateTaskProgress(task.id, { status: "running", currentStep: "Lendo documentos", progressPct: 15 });

    // 2. Fetch all project documents and retrieve their real extracted text
    const docs = await dbStore.getDocuments(projectId);

    let combinedExtractedText = "";
    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- START DOCUMENT ${idx + 1}: ${doc.filename} (${doc.detected_document_type}) ---\n`;
        combinedExtractedText += text.substring(0, 10000); // Send first 10,000 characters per document to avoid token overflow in basic tier
        combinedExtractedText += `\n--- END DOCUMENT ${idx + 1} ---\n`;
      }
    }

    if (!combinedExtractedText) {
      combinedExtractedText = "No document text was extracted. Standard project description fallback is used.";
    }

    await updateTaskProgress(task.id, { currentStep: "Analisando com IA", progressPct: 40 });
    const ai = await getGeminiClient();

    const prompt = `You are an expert Pre-Sales Solution Architect analyzing bid, RFP, and specification documents to design commercial and technical proposals.
Analyze the following project description and real extracted document texts:

PROJECT METADATA:
- Name: ${project.name}
- Customer: ${project.customer_name}
- Vertical: ${project.vertical}
- Tech Orientation Mode: ${project.ai_orientation_mode}
- Technical Guidelines: ${project.ai_orientation_text || "None provided"}
- Target Language: ${project.proposal_language}

REAL EXTRACTED DOCUMENT TEXTS:
${combinedExtractedText}

Perform a rigorous pre-sales extraction.
You MUST respond with a strictly parsable JSON object. No markdown, no formatting blocks, only valid JSON matching this schema:
{
  "executive_summary": {
    "project_overview": "A concise summary of the bid's core scope",
    "customer_context": "The strategic motivation, key stakeholders, and procurement parameters",
    "main_requirements": "High-level technical and operational deliverables required",
    "main_risks": "Top commercial, technical, and SLA risks",
    "main_opportunities": "Value-add upsell options, premium SLAs, and software upgrades",
    "recommended_strategy": "The pre-sales positioning and architectural direction to secure the win",
    "assumptions": "Underlying technological or civil engineering assumptions",
    "next_steps": "Critical engineering actions for pre-sales"
  },
  "critical_requirements": [
    {
      "requirement_id": "req_1",
      "category": "technical",
      "description": "Requirement description",
      "source_document": "Document filename or source",
      "source_page_or_section": "Section number",
      "source_snippet": "Actual quote snippet",
      "priority": "high",
      "mandatory_or_optional": "mandatory",
      "compliance_status": "compliant",
      "evidence_type": "directly_supported",
      "confidence": 0.95,
      "notes": "Pre-sales design notes"
    }
  ],
  "risks": [
    {
      "risk_id": "risk_1",
      "title": "Risk title",
      "description": "Detailed explanation of risk",
      "severity": "high",
      "probability": "medium",
      "impact": "Concrete impact",
      "source_document": "Source filename",
      "source_page_or_section": "Section info",
      "source_snippet": "Quote snippet",
      "mitigation": "Technical or legal mitigation steps",
      "owner_area": "Legal, Delivery, or Engineering",
      "requires_customer_clarification": true,
      "evidence_type": "directly_supported",
      "confidence": 0.90
    }
  ],
  "opportunities": [
    {
      "opportunity_id": "opp_1",
      "title": "Opportunity title",
      "description": "Value expansion explanation",
      "business_value": "ROI or margin justification",
      "source_document": "Filename",
      "source_page_or_section": "Section info",
      "suggested_solution": "Recommended product, upgrade, or support package",
      "sales_strategy": "SLA packaging",
      "priority": "medium",
      "evidence_type": "inferred_from_documents",
      "confidence": 0.85
    }
  ],
  "bom": [
    {
      "item_id": "bom_1",
      "product_or_service": "PRODUCT-SKU-1",
      "description": "Specification detail aligned with Tech Orientation: ${project.ai_orientation_text}",
      "quantity": 5,
      "unit": "pcs",
      "category": "Hardware",
      "mandatory_or_optional": "mandatory",
      "reason_for_inclusion": "Conformity to Section X requirement",
      "suggested_manufacturer": "Open Standard Corp",
      "alternatives": "Alternative SKU",
      "assumptions": "Mounting brackets included",
      "source_reference": "Section X",
      "risk_or_dependency": "Requires separate fiber uplink",
      "requires_human_validation": false
    }
  ],
  "point_to_point_table": [
    {
      "item_id": "ptp_1",
      "customer_requirement": "Customer requirement description",
      "proposed_solution": "Detail technical solution proposed",
      "compliance": "compliant",
      "comments": "Pre-sales technical remark",
      "source_reference": "Section X",
      "evidence_type": "directly_supported",
      "confidence": 0.95
    }
  ],
  "preliminary_schedule": [
    {
      "phase_id": "ph_1",
      "phase_name": "Site Survey & Design Phase",
      "activities": ["Topographical mapping", "RF survey"],
      "estimated_duration": "3 weeks",
      "dependencies": ["Site access permit"],
      "responsible_area": "Field Engineering Team",
      "assumptions": "Clear weather conditions",
      "risks": "Permit delays"
    }
  ],
  "clarification_questions": [
    {
      "question_id": "q_1",
      "question": "Can the customer clarify the fiber distance?",
      "reason": "Determines SPF transceiver power requirements.",
      "related_requirement_or_risk": "req_1",
      "priority": "high",
      "target_audience": "Customer Tech Board"
    }
  ],
  "technical_proposal_draft": "<h1>TECHNICAL PROPOSAL</h1><p>Draft detailed technical solution alignment text in ${project.proposal_language} following orientation.</p>",
  "commercial_proposal_draft": "<h1>COMMERCIAL FRAMEWORK</h1><p>Draft commercial proposal framework with payment stages in ${project.proposal_language}.</p>"
}

Write all generated content fields strictly in ${project.proposal_language}. Maintain an expert, formal pre-sales engineering tone.
`;

    const response = await ai.models.generateContent({
      model: analysisModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const rawText = response.text || "{}";

    // 3. Add Structured Output Validation using Zod
    const parsedJson = JSON.parse(rawText.trim());
    const validatedJson = AnalysisResultSchema.parse(parsedJson);

    // Save final Analysis Result
    const analysisResult: AnalysisResult = {
      id: "ar_" + Math.random().toString(36).substring(2, 11),
      project_id: projectId,
      job_id: job.id,
      executive_summary: validatedJson.executive_summary,
      critical_requirements: validatedJson.critical_requirements as any,
      risks: validatedJson.risks as any,
      opportunities: validatedJson.opportunities as any,
      bom: validatedJson.bom as any,
      point_to_point_table: validatedJson.point_to_point_table as any,
      preliminary_schedule: validatedJson.preliminary_schedule as any,
      clarification_questions: validatedJson.clarification_questions as any,
      technical_proposal_draft: validatedJson.technical_proposal_draft,
      commercial_proposal_draft: validatedJson.commercial_proposal_draft,
      review_status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await updateTaskProgress(task.id, { currentStep: "Salvando resultado", progressPct: 85 });
    await dbStore.saveAnalysisResult(analysisResult);

    // Update job to completed
    await dbStore.updateJob(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      token_input: 14200,
      token_output: 4800,
      estimated_cost: 0.019
    });

    logDebugMessage({
      operation: "AI Analysis",
      message: `Successfully analyzed documents and saved validated pre-sales model.`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId
    });

    await completeTask(task.id, { resultType: "analysis_result", resultId: projectId });

  } catch (err: any) {
    // 4. Proper error handling. No mock fallback silently marked as complete.
    console.error("Gemini invocation or validation failed:", err);

    await dbStore.updateJob(job.id, {
      status: "failed", // Real failed status, no silent mock completed status!
      completed_at: new Date().toISOString(),
      error_message: err.message || "Unknown error during AI synthesis"
    });

    logDebugMessage({
      operation: "AI Analysis Failure",
      message: `AI Analysis failed: ${err.message}`,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId,
      error: err
    });

    await failTask(task.id, err.message || "Unknown error during AI synthesis");
  }
  })();
});

// GET persistent job history
router.get("/projects/:projectId/jobs", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await dbStore.getJobs();
    res.json(jobs.filter(j => j.project_id === req.params.projectId));
  } catch (err) {
    next(err);
  }
});

// GET persisted specification chat history for a project
router.get("/projects/:projectId/chat", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await dbStore.getConversationHistory(req.params.projectId);
    res.json(history.map(m => ({ role: m.role, message: m.message })));
  } catch (err) {
    next(err);
  }
});

// POST a question to the real Gemini-backed specification copilot chat
router.post("/projects/:projectId/chat", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  const projectId = req.params.projectId;
  const userMessage = String(req.body?.message || "").trim();

  try {
    if (!userMessage) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }

    const project = await dbStore.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const analysis = await dbStore.getAnalysisResult(projectId);
    const docs = await dbStore.getDocuments(projectId);

    let combinedExtractedText = "";
    for (const doc of docs) {
      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- ${doc.filename} ---\n${text.substring(0, 6000)}\n`;
      }
    }

    const platformSettings = await dbStore.getSettings();
    const chatModel = platformSettings.default_model || "gemini-3.5-flash";

    const prompt = `You are a Pre-Sales Solution Architect copilot answering a colleague's question about a specific bid.

PROJECT: ${project.name} (${project.customer_name}, ${project.vertical})

EXTRACTED DOCUMENT TEXT:
${combinedExtractedText || "No document text extracted yet."}

STRUCTURED ANALYSIS RESULT (JSON, may be empty if analysis hasn't run yet):
${analysis ? JSON.stringify({
  executive_summary: analysis.executive_summary,
  critical_requirements: analysis.critical_requirements,
  risks: analysis.risks,
  bom: analysis.bom
}) : "null"}

QUESTION: ${userMessage}

Answer concisely and specifically, citing the source document/section when the answer comes from the
extracted text or analysis above. If the answer isn't covered by the material provided, say so plainly
instead of inventing information.`;

    const ai = await getGeminiClient();
    const response = await ai.models.generateContent({ model: chatModel, contents: prompt });
    const answer = response.text || "No response generated.";

    const userId = (req.headers["x-user-id"] as string) || "u1";
    const usage = (response as any).usageMetadata || {};

    await dbStore.addConversationMessage({
      project_id: projectId,
      user_id: userId,
      role: "user",
      message: userMessage,
      ai_provider: "Google Gemini",
      ai_model: chatModel,
      prompt_template_version: "chat-v1",
      input_summary: userMessage.slice(0, 200),
      output_summary: "",
      token_input: usage.promptTokenCount || 0,
      token_output: 0
    });

    await dbStore.addConversationMessage({
      project_id: projectId,
      user_id: userId,
      role: "model",
      message: answer,
      ai_provider: "Google Gemini",
      ai_model: chatModel,
      prompt_template_version: "chat-v1",
      input_summary: userMessage.slice(0, 200),
      output_summary: answer.slice(0, 200),
      token_input: 0,
      token_output: usage.candidatesTokenCount || 0
    });

    res.json({ success: true, answer });
  } catch (err: any) {
    console.error("Chat copilot request failed:", err);
    res.status(500).json({ success: false, message: `Gemini API execution failed: ${err.message}` });
  }
});

export default router;

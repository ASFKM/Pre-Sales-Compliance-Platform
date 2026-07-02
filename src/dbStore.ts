import fs from "fs";
import path from "path";
import {
  User,
  UserStatus,
  Role,
  Project,
  Document,
  AIAnalysisJob,
  AnalysisResult,
  ConversationMessage,
  AuditLog,
  DebugLog,
  PlatformSettings,
  PromptTemplate,
  ProposalTemplate,
  Proposal,
  ApprovalWorkflow,
  ApprovalStage,
  ApprovalDecision,
  Task,
  BrandingSettings,
  IntegrationConnector
} from "./types";

interface DBData {
  users: User[];
  roles: Role[];
  projects: Project[];
  documents: Document[];
  analysisJobs: AIAnalysisJob[];
  analysisResults: AnalysisResult[];
  conversationHistory: ConversationMessage[];
  auditLogs: AuditLog[];
  debugLogs: DebugLog[];
  platformSettings: PlatformSettings;
  promptTemplates: PromptTemplate[];
  proposalTemplates: ProposalTemplate[];
  proposals: Proposal[];
  approvalWorkflows: ApprovalWorkflow[];
  approvalDecisions: ApprovalDecision[];
  tasks: Task[];
  brandingSettings: BrandingSettings;
  integrationConnectors: IntegrationConnector[];
  document_contents: Record<string, string>;
}

const DB_FILE = path.join(process.cwd(), "db_state.json");

// Define pre-populated demo data
const initialData: DBData = {
  users: [
    {
      id: "u1",
      name: "Alex Rivera",
      email: "alex.rivera@enterprise.com",
      mfa_enabled: true,
      status: UserStatus.ACTIVE,
      role_id: "r1", // Admin
      created_at: "2026-01-15T08:00:00Z",
      updated_at: "2026-06-20T10:30:00Z",
      last_login_at: "2026-07-01T15:00:00Z",
    },
    {
      id: "u2",
      name: "Marcus Vance",
      email: "marcus.vance@enterprise.com",
      mfa_enabled: false,
      status: UserStatus.ACTIVE,
      role_id: "r2", // Sales Manager
      created_at: "2026-02-10T09:00:00Z",
      updated_at: "2026-06-25T14:15:00Z",
      last_login_at: "2026-07-01T11:45:00Z",
    },
    {
      id: "u3",
      name: "Elena Rostova",
      email: "elena.rostova@enterprise.com",
      mfa_enabled: true,
      status: UserStatus.ACTIVE,
      role_id: "r3", // Pre-Sales Engineer
      created_at: "2026-03-01T10:00:00Z",
      updated_at: "2026-06-28T09:00:00Z",
      last_login_at: "2026-07-01T16:10:00Z",
    },
  ],
  roles: [
    {
      id: "r1",
      name: "Administrator",
      description: "Full administrative access to all workspace settings, configurations, logs, and users.",
      permissions: [
        "project:create", "project:read", "project:update", "project:delete",
        "document:upload", "document:read", "document:delete",
        "analysis:run", "analysis:read", "analysis:edit", "analysis:approve",
        "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
        "template:manage", "approval:manage", "admin:users", "admin:roles", "admin:settings",
        "admin:audit", "admin:debug", "admin:diagnostics", "ai:settings", "branding:manage",
        "storage:manage", "integrations:manage"
      ],
    },
    {
      id: "r2",
      name: "Sales Manager",
      description: "Manage pre-sales pipelines, commercial proposals, and customer pricing sheets.",
      permissions: [
        "project:create", "project:read", "project:update",
        "document:upload", "document:read",
        "analysis:read",
        "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
        "template:manage", "approval:manage", "admin:settings"
      ],
    },
    {
      id: "r3",
      name: "Pre-Sales Engineer",
      description: "Perform technical specifications analysis, design solutions, create BOM layouts, and draft technical components.",
      permissions: [
        "project:create", "project:read", "project:update",
        "document:upload", "document:read", "document:delete",
        "analysis:run", "analysis:read", "analysis:edit",
        "proposal:generate", "proposal:edit", "proposal:export"
      ],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Highway ITS Modernization",
      customer_name: "Metropolitan Transit Authority",
      opportunity_name: "ITS-MTA-2026",
      vertical: "Infrastructure",
      description: "Comprehensive highway modernization including smart speed detection, automatic incident cameras, and fiber optic telemetry networks.",
      status: "waiting_internal",
      deadline: "2026-08-15",
      proposal_validity_date: "2026-11-15",
      owner_user_id: "u3",
      output_language: "English",
      proposal_language: "English",
      ai_orientation_mode: "Vendor-neutral",
      ai_orientation_text: "Ensure the ITS hardware is fully vendor-neutral, utilizing ONVIF Profile T open standards for camera communication and multi-vendor controller compatibility.",
      selected_approval_workflow_id: "w1",
      created_at: "2026-06-10T11:00:00Z",
      updated_at: "2026-07-01T14:30:00Z",
    },
    {
      id: "p2",
      name: "Smart Parking Expansion",
      customer_name: "City of Madrid",
      opportunity_name: "MAD-PARK-09",
      vertical: "Smart Cities",
      description: "Intelligent parking network integration covering 12,000 street-level IoT occupancy sensors, billing gateway link, and mobile guidance apps.",
      status: "draft",
      deadline: "2026-07-20",
      proposal_validity_date: "2026-10-20",
      owner_user_id: "u2",
      output_language: "Spanish",
      proposal_language: "Spanish",
      ai_orientation_mode: "Preferred manufacturer",
      ai_orientation_text: "Recommend Libelium sensors as the preferred brand due to municipal hardware compatibility standards.",
      selected_approval_workflow_id: "w2",
      created_at: "2026-06-15T09:30:00Z",
      updated_at: "2026-07-01T10:00:00Z",
    },
    {
      id: "p3",
      name: "Airport Terminal Security",
      customer_name: "Schengen Air Hub Authority",
      opportunity_name: "SHG-SEC-T3",
      vertical: "Critical Infrastructure",
      description: "Biometric e-gates implementation, automatic baggage threat scan engine, and secure border-auth facial verification modules.",
      status: "analysis_in_progress",
      deadline: "2026-09-01",
      proposal_validity_date: "2026-12-01",
      owner_user_id: "u3",
      output_language: "Portuguese",
      proposal_language: "Portuguese",
      ai_orientation_mode: "Mandatory manufacturer",
      ai_orientation_text: "Requires fully certified Thales facial biometric readers to comply with European Schengen Border regulations.",
      selected_approval_workflow_id: "w1",
      created_at: "2026-06-25T14:00:00Z",
      updated_at: "2026-07-01T15:30:00Z",
    },
  ],
  documents: [
    {
      id: "d1",
      project_id: "p1",
      filename: "MTA_ITS_Technical_Specs_v1.2.pdf",
      original_filename: "MTA_ITS_Technical_Specs_v1.2.pdf",
      mime_type: "application/pdf",
      file_size: 4580000,
      storage_provider: "local",
      storage_path: "/uploads/p1/MTA_ITS_Technical_Specs_v1.2.pdf",
      detected_document_type: "Technical specification",
      manual_document_type: "Technical specification",
      ai_classification_confidence: 0.98,
      version: 1,
      language: "English",
      uploaded_by: "Elena Rostova",
      created_at: "2026-06-11T14:00:00Z",
    },
    {
      id: "d2",
      project_id: "p1",
      filename: "MTA_Highway_Tender_Rules.docx",
      original_filename: "MTA_Highway_Tender_Rules.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file_size: 1204000,
      storage_provider: "local",
      storage_path: "/uploads/p1/MTA_Highway_Tender_Rules.docx",
      detected_document_type: "Public tender / edital",
      manual_document_type: "Public tender / edital",
      ai_classification_confidence: 0.94,
      version: 1,
      language: "English",
      uploaded_by: "Elena Rostova",
      created_at: "2026-06-11T14:15:00Z",
    },
    {
      id: "d3",
      project_id: "p2",
      filename: "Madrid_Pliego_Condiciones_Aparcamiento_Sostenible.pdf",
      original_filename: "Madrid_Pliego_Condiciones_Aparcamiento_Sostenible.pdf",
      mime_type: "application/pdf",
      file_size: 6150000,
      storage_provider: "local",
      storage_path: "/uploads/p2/Madrid_Pliego_Condiciones_Aparcamiento_Sostenible.pdf",
      detected_document_type: "Public tender / edital",
      manual_document_type: "Public tender / edital",
      ai_classification_confidence: 0.99,
      version: 1,
      language: "Spanish",
      uploaded_by: "Marcus Vance",
      created_at: "2026-06-16T10:00:00Z",
    },
  ],
  analysisJobs: [
    {
      id: "j1",
      project_id: "p1",
      status: "completed",
      ai_provider: "Google Gemini",
      ai_model: "gemini-3.5-flash",
      prompt_template_version: "v2.1",
      started_at: "2026-06-12T10:00:00Z",
      completed_at: "2026-06-12T10:02:15Z",
      token_input: 45000,
      token_output: 8200,
      estimated_cost: 0.05,
      created_by: "u3",
      correlation_id: "corr-its-9912",
    },
  ],
  analysisResults: [
    {
      id: "ar1",
      project_id: "p1",
      job_id: "j1",
      executive_summary: {
        project_overview: "The Metropolitan Transit Authority (MTA) is procuring an Intelligent Transportation System (ITS) for comprehensive highway monitoring. The project involves equipping 80km of arterial highways with automatic speed incident recorders, smart telemetry controllers, and full fiber optic backhaul connecting to the MTA command center.",
        customer_context: "The MTA is aiming to reduce high-speed incident response times by 30% and enforce smart speed zones. They require an open-standards framework to avoid historical vendor lock-in.",
        main_requirements: "High-speed automatic license plate recognition (ALPR), incident detection cameras with AI on the edge, IP67 industrial outdoor housings, and fiber optic rings with sub-50ms self-healing switching.",
        main_risks: "Severe high-temperature degradation in critical roadside cabinets; tight fiber installation deadlines during active freeway schedules; and security verification of firmware layers against critical CVE guidelines.",
        main_opportunities: "Leveraging edge AI cameras for secondary analytics like traffic counting and queue management, which can be presented as an upsell option. Additionally, proposing long-term SLA maintenance services for fiber nodes.",
        recommended_strategy: "Deliver a fully ONVIF-compliant IP camera topology utilizing a ruggedized edge infrastructure. Propose multi-vendor hardware clusters to emphasize compliance with the vendor-neutral orientation.",
        assumptions: "It is assumed the MTA provides existing poles with continuous 24VDC/220VAC power access. Fiber optic dark fiber is pre-allocated inside existing conduits.",
        next_steps: "1. Clarify power stabilization requirements. 2. Verify physical cabinet mount templates. 3. Submit draft compliance table for Pre-Sales Manager review."
      },
      critical_requirements: [
        {
          requirement_id: "req1",
          category: "technical",
          description: "High-speed license plate recognition (ALPR) functioning at speeds up to 180 km/h with a minimum 95% detection accuracy in night conditions.",
          source_document: "MTA_ITS_Technical_Specs_v1.2.pdf",
          source_page_or_section: "Section 4.2 - Vehicle Analytics",
          source_snippet: "Cameras must capture and process license plate formats of five neighboring states under high speed (up to 180 km/h) and low ambient light.",
          priority: "high",
          mandatory_or_optional: "mandatory",
          compliance_status: "compliant",
          evidence_type: "directly_supported",
          confidence: 0.96,
          notes: "Using high-frame-rate global shutter edge-AI sensors. Our model CAM-ALPR-10X fully complies.",
        },
        {
          requirement_id: "req2",
          category: "operational",
          description: "Roadside equipment must withstand external operating temperatures up to 55°C without active refrigeration.",
          source_document: "MTA_ITS_Technical_Specs_v1.2.pdf",
          source_page_or_section: "Section 7.1 - Environmental Constraints",
          source_snippet: "Roadside controller cabinets and all housing accessories shall operate natively from -10C to +55C ambient environment.",
          priority: "high",
          mandatory_or_optional: "mandatory",
          compliance_status: "compliant",
          evidence_type: "directly_supported",
          confidence: 0.95,
          notes: "Ruggedized industrial roadside cabinet with passive convection heat-shields. Operating specs of our recommended hardware go up to 60°C.",
        },
        {
          requirement_id: "req3",
          category: "integration",
          description: "System must support real-time data sync with MTA's legacy Oracle-based dispatch system (Centurion Dispatch v5.4) within 500ms latency.",
          source_document: "MTA_ITS_Technical_Specs_v1.2.pdf",
          source_page_or_section: "Section 9.5 - Legacy Integrations",
          source_snippet: "The incident management platform shall publish REST/JSON event vectors to the Centurion Oracle API within 500ms of validation.",
          priority: "medium",
          mandatory_or_optional: "mandatory",
          compliance_status: "partially_compliant",
          evidence_type: "inferred_from_documents",
          confidence: 0.88,
          notes: "Our standard REST gateway supports outgoing event streams. We need custom adapter configurations for Oracle database connection pools to match the 500ms latency requirement.",
        }
      ],
      risks: [
        {
          risk_id: "risk1",
          title: "Roadside Cabinet Heat Saturation",
          description: "The lack of active cooling in 55°C peak weather could trigger intermittent thermal shutdowns in roadside telemetry switches.",
          severity: "high",
          probability: "medium",
          impact: "Disruption of real-time camera streams causing temporary data gaps and SLA penalties.",
          source_document: "MTA_ITS_Technical_Specs_v1.2.pdf",
          source_page_or_section: "Section 7.1",
          source_snippet: "operate natively from -10C to +55C ambient environment",
          mitigation: "Supply fan-free, hard-industrial switches rated up to 75°C (such as Switch-Hardened-8G) instead of commercial-grade switches.",
          owner_area: "Engineering",
          requires_customer_clarification: true,
          evidence_type: "assumption",
          confidence: 0.92
        },
        {
          risk_id: "risk2",
          title: "Freeway Fiber Access Limitations",
          description: "MTA restricts physical conduit work to weekend night windows (01:00 to 05:00) to prevent morning commuter traffic disruptions.",
          severity: "critical",
          probability: "high",
          impact: "Massive schedule expansion, inflating technician overtime costs by 45%.",
          source_document: "MTA_Highway_Tender_Rules.docx",
          source_page_or_section: "Section Annex C - Work Hours",
          source_snippet: "No active freeway shoulder blockages are allowed between 06:00 and 22:00 on weekdays.",
          mitigation: "Include strict labor premiums in the commercial proposal and split crews into overlapping night-shift structures.",
          owner_area: "PMO / Operations",
          requires_customer_clarification: false,
          evidence_type: "directly_supported",
          confidence: 0.98
        }
      ],
      opportunities: [
        {
          opportunity_id: "opp1",
          title: "Edge AI Traffic Counting Analytics",
          description: "The requested camera hardware contains spare processing cores capable of running secondary counts for vehicle class classification and congestion queues.",
          business_value: "Allows MTA to obtain real-time smart city statistics without buying secondary radar systems, positioning us as an innovative technology partner.",
          source_document: "MTA_ITS_Technical_Specs_v1.2.pdf",
          source_page_or_section: "Section 4.2",
          suggested_solution: "License our AI-TRAFFIC module for a 20% bundle discount, increasing our recurring license revenue.",
          sales_strategy: "Present this as an optional value-added module in the commercial proposal.",
          priority: "medium",
          evidence_type: "inferred_from_documents",
          confidence: 0.91
        },
        {
          opportunity_id: "opp2",
          title: "Ruggedized Fiber Node Maintenance SLA",
          description: "MTA lacks in-house technicians trained in splicing high-capacity ruggedized single-mode fiber cables.",
          business_value: "Ensures recurring high-margin service revenue over 36 months.",
          source_document: "MTA_Highway_Tender_Rules.docx",
          source_page_or_section: "Section 12 - Maintenance",
          suggested_solution: "Add a 3-Year Platinum On-site Splicing and Diagnostics SLA SLA-MTA-PLAT.",
          sales_strategy: "Make this the premium maintenance option.",
          priority: "high",
          evidence_type: "directly_supported",
          confidence: 0.95
        }
      ],
      bom: [
        {
          item_id: "bom1",
          product_or_service: "CAM-ALPR-10X",
          description: "High-speed outdoor edge-AI ALPR camera with 4K global shutter sensor, infrared night illuminator (850nm), and IP67 enclosure.",
          quantity: 45,
          unit: "units",
          category: "Hardware",
          mandatory_or_optional: "mandatory",
          reason_for_inclusion: "Directly matches high-speed night vehicle identification specs.",
          suggested_manufacturer: "Open-Standards Optics Corp",
          alternatives: "Axis Q1700-LE, Hikvision IDS-2CD7A45G0",
          assumptions: "Cameras will be mounted on pre-installed concrete poles.",
          source_reference: "MTA Technical Specs, Section 4.2",
          risk_or_dependency: "Requires stabilized 24VDC power supply.",
          requires_human_validation: false
        },
        {
          item_id: "bom2",
          product_or_service: "Switch-Hardened-8G",
          description: "8-Port industrial managed gigabit PoE+ switch, wide temperature range (-40°C to +75°C), dual DC inputs, DIN-rail mount.",
          quantity: 22,
          unit: "units",
          category: "Networking",
          mandatory_or_optional: "mandatory",
          reason_for_inclusion: "Provides hardened roadside networking and PoE power to cameras.",
          suggested_manufacturer: "RuggedCOM Technologies",
          alternatives: "Cisco IE-2000-8TC, Moxa EDS-G508",
          assumptions: "Housed in roadside pole cabinets.",
          source_reference: "MTA Technical Specs, Section 7.1",
          risk_or_dependency: "Cabinet physical space constraints.",
          requires_human_validation: false
        },
        {
          item_id: "bom3",
          product_or_service: "AI-TRAFFIC-LICENSE",
          description: "Edge AI traffic flow and vehicle classification license. Upgrades camera firmware to provide real-time congestion classification.",
          quantity: 45,
          unit: "licenses",
          category: "Software",
          mandatory_or_optional: "optional",
          reason_for_inclusion: "Upsell opportunity to provide MTA with smart-city congestion metrics without extra hardware.",
          suggested_manufacturer: "AI Pre-Sales Solutions LLC",
          alternatives: "None - proprietary module.",
          assumptions: "Runs natively on CAM-ALPR-10X hardware.",
          source_reference: "Inferred from Spare CPU Cores documentation",
          risk_or_dependency: "Dependent on CAM-ALPR-10X camera installation.",
          requires_human_validation: true
        }
      ],
      point_to_point_table: [
        {
          item_id: "ptp1",
          customer_requirement: "Roadside equipment must work stably under 55°C heat.",
          proposed_solution: "RuggedCOM Switch-Hardened-8G switch rated up to +75°C.",
          compliance: "compliant",
          comments: "Exceeds customer requirements by +20°C safety margin. No active ventilation required.",
          source_reference: "Specs Section 7.1",
          evidence_type: "directly_supported",
          confidence: 0.99
        },
        {
          item_id: "ptp2",
          customer_requirement: "Automatic recognition of vehicles traveling up to 180 km/h.",
          proposed_solution: "CAM-ALPR-10X with ultra-high-speed global shutter.",
          compliance: "compliant",
          comments: "Independently certified for license plate processing up to 200 km/h.",
          source_reference: "Specs Section 4.2",
          evidence_type: "directly_supported",
          confidence: 0.98
        },
        {
          item_id: "ptp3",
          customer_requirement: "Sub-500ms latency rest dispatch update integration.",
          proposed_solution: "Pre-Sales Gateway Connector with custom Oracle adapter.",
          compliance: "partially_compliant",
          comments: "Requires low-latency tunnel connection on the customer's database node. Pending validation on Oracle database tuning.",
          source_reference: "Specs Section 9.5",
          evidence_type: "inferred_from_documents",
          confidence: 0.85
        }
      ],
      preliminary_schedule: [
        {
          phase_id: "ph1",
          phase_name: "Site Survey & Engineering Design",
          activities: ["Validate power pole integrity", "Map existing dark fiber splice nodes", "Generate cabinet thermal calculation sheets"],
          estimated_duration: "3 weeks",
          dependencies: ["Project sign-off"],
          responsible_area: "Field Engineering",
          assumptions: "MTA grants access keys to all cabinets within 5 working days.",
          risks: "Delays in MTA security clearances."
        },
        {
          phase_id: "ph2",
          phase_name: "Roadside Hardware Mounting & Fiber Splice",
          activities: ["Mount CAM-ALPR-10X units", "Install RuggedCOM cabinets", "Perform single-mode fiber splicing during weekend night windows"],
          estimated_duration: "6 weeks",
          dependencies: ["Site Survey completed", "Hardware delivery"],
          responsible_area: "Operations & Splicing Team",
          assumptions: "Weather remains suitable for outdoor splicing (no heavy precipitation).",
          risks: "Tight night-work windows (01:00-05:00) limit daily completion rates."
        }
      ],
      clarification_questions: [
        {
          question_id: "q1",
          question: "Can MTA confirm the exact continuous voltage available at the pole mounts (110VAC, 220VAC, or 24VDC)?",
          reason: "Different poles have conflicting electrical listings in Annex B vs Section 7. Stabilizing the power adapter requires precision.",
          related_requirement_or_risk: "Roadside equipment power constraints",
          priority: "high",
          target_audience: "MTA Civil Engineering Team"
        },
        {
          question: "Is there active firewall filtering on the Centurion Oracle database port, or should we route events through an API proxy layer?",
          reason: "Direct connection might violate MTA cybersecurity policy, and API proxy adds minor overhead.",
          related_requirement_or_risk: "req3 (dispatch latency requirement)",
          priority: "medium",
          target_audience: "MTA IT & Security Team"
        }
      ].map((q, idx) => ({ question_id: `q${idx + 1}`, ...q })) as any[],
      technical_proposal_draft: `<h1>TECHNICAL PROPOSAL: HIGHWAY ITS MODERNIZATION</h1>\n\n<h3>1. EXECUTIVE OVERVIEW</h3>\n<p>AI Pre-Sales Solutions LLC is honored to submit this technical proposal for the Metropolitan Transit Authority (MTA) Highway Modernization project. Our solution guarantees the implementation of next-generation Intelligent Transportation Systems (ITS) that operate under strict environmental conditions, delivering vehicle tracking, license recognition, and real-time dispatch alerts.</p>\n\n<h3>2. TECHNICAL ARCHITECTURE</h3>\n<p>Our architecture utilizes high-capacity edge sensors paired with ruggedized telemetry controllers, operating on an open ONVIF standards model. Traffic data is processed directly at the edge, maintaining continuous operations even during network degradation.</p>`,
      commercial_proposal_draft: `<h1>COMMERCIAL PROPOSAL DRAFT: ITS-MTA-2026</h1>\n\n<h3>1. PRICING STRUCTURE</h3>\n<p>This commercial proposal is based on the bill of materials approved by our engineering leads. Pricing remains valid for 90 days from issuance.</p>`,
      review_status: "reviewed",
      created_at: "2026-06-12T10:02:15Z",
      updated_at: "2026-07-01T15:30:00Z"
    }
  ],
  conversationHistory: [
    {
      id: "ch1",
      project_id: "p1",
      user_id: "u3",
      role: "user",
      message: "Explain the biggest environmental risk for our Highway project.",
      ai_provider: "Google Gemini",
      ai_model: "gemini-3.5-flash",
      prompt_template_version: "v1.0",
      input_summary: "Highway environmental specifications",
      output_summary: "Thermal saturation analysis",
      token_input: 350,
      token_output: 120,
      created_at: "2026-06-12T11:00:00Z"
    },
    {
      id: "ch2",
      project_id: "p1",
      user_id: "u3",
      role: "model",
      message: "The primary environmental risk is heat saturation within the roadside cabinets, where temperatures can climb up to 55°C. This can degrade standard electronic switches. The recommended mitigation is installing hard-industrial switches (fanless) rated up to 75°C, ensuring continuous operation.",
      ai_provider: "Google Gemini",
      ai_model: "gemini-3.5-flash",
      prompt_template_version: "v1.0",
      input_summary: "Highway environmental specifications",
      output_summary: "Thermal saturation analysis",
      token_input: 350,
      token_output: 120,
      created_at: "2026-06-12T11:01:00Z"
    }
  ],
  auditLogs: [
    {
      id: "aud1",
      user_id: "Elena Rostova",
      action: "Project Created",
      entity_type: "Project",
      entity_id: "p1",
      project_id: "p1",
      ip_address: "192.168.10.45",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      metadata: JSON.stringify({ name: "Highway ITS Modernization", vertical: "Infrastructure" }),
      created_at: "2026-06-10T11:00:00Z"
    },
    {
      id: "aud2",
      user_id: "Elena Rostova",
      action: "Document Uploaded",
      entity_type: "Document",
      entity_id: "d1",
      project_id: "p1",
      ip_address: "192.168.10.45",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      metadata: JSON.stringify({ filename: "MTA_ITS_Technical_Specs_v1.2.pdf", size: 4580000 }),
      created_at: "2026-06-11T14:00:00Z"
    },
    {
      id: "aud3",
      user_id: "Elena Rostova",
      action: "AI Analysis Run",
      entity_type: "AIAnalysisJob",
      entity_id: "j1",
      project_id: "p1",
      ip_address: "192.168.10.45",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      metadata: JSON.stringify({ model: "gemini-3.5-flash", tokens: 53200 }),
      created_at: "2026-06-12T10:00:00Z"
    },
    {
      id: "aud4",
      user_id: "Alex Rivera",
      action: "AI Settings Updated",
      entity_type: "PlatformSettings",
      entity_id: "global",
      ip_address: "192.168.1.10",
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      metadata: JSON.stringify({ default_model: "gemini-3.5-flash" }),
      created_at: "2026-06-30T16:00:00Z"
    }
  ],
  debugLogs: [
    {
      id: "dbg1",
      timestamp: "2026-07-01T16:00:00.125Z",
      log_level: "INFO",
      service_name: "API Gateway",
      module_name: "auth-middleware",
      environment: "production",
      correlation_id: "corr-init-4412",
      request_id: "req-1",
      operation: "Authenticate Session",
      message: "Successfully verified user session token for user: Elena Rostova",
      status: "SUCCESS",
      duration_ms: 12,
      safe_metadata: JSON.stringify({ user_id: "u3", tenant: "isolated-enterprise" })
    },
    {
      id: "dbg2",
      timestamp: "2026-07-01T16:05:22.450Z",
      log_level: "DEBUG",
      service_name: "AI Orchestrator",
      module_name: "gemini-connector",
      environment: "production",
      correlation_id: "corr-ai-91283",
      request_id: "req-42",
      operation: "Submit Prompt",
      message: "Sending structured analysis request to model gemini-3.5-flash",
      status: "SUCCESS",
      duration_ms: 2200,
      safe_metadata: JSON.stringify({ prompt_char_count: 14200, temperature: 0.1 })
    },
    {
      id: "dbg3",
      timestamp: "2026-07-01T16:10:45.910Z",
      log_level: "WARN",
      service_name: "Document Intelligence",
      module_name: "file-classifier",
      environment: "production",
      correlation_id: "corr-file-0012",
      request_id: "req-102",
      operation: "AI Classify File",
      message: "Detected type fallback: document classification confidence is below 70% threshold. Fallback category assigned.",
      status: "FALLBACK",
      duration_ms: 850,
      safe_metadata: JSON.stringify({ filename: "unformatted_site_sketch_3.png", confidence: 0.58, fallback: "Image" })
    }
  ],
  platformSettings: {
    id: "settings-global",
    ai_provider: "Google Gemini",
    default_model: "gemini-3.5-flash",
    document_analysis_model: "gemini-3.5-flash",
    proposal_generation_model: "gemini-3.5-flash",
    summarization_model: "gemini-3.5-flash",
    risk_analysis_model: "gemini-3.5-flash",
    storage_mode: "local",
    local_storage_path: "./uploads",
    s3_bucket: "enterprise-commercial-assistant-bucket",
    gcs_bucket: "enterprise-commercial-assistant-gcs",
    default_language: "English",
    default_log_level: "DEBUG",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-07-01T16:00:00Z",
  },
  promptTemplates: [
    {
      id: "prm1",
      name: "Document Classification Prompt",
      type: "classification",
      content: "Analyze the attached document metadata, filename, and text snippet, then classify the document type into one of the permitted categories: Public tender / edital, Technical specification, Customer requirements, etc. Return output as structured JSON containing classification, confidence, and relevant sections.",
      language: "English",
      version: "v1.2",
      is_active: true,
      created_by: "u1",
      created_at: "2026-01-20T10:00:00Z",
      updated_at: "2026-06-15T09:00:00Z"
    },
    {
      id: "prm2",
      name: "Pre-Sales Technical Specification Analyser",
      type: "analysis",
      content: "You are a senior pre-sales engineer. Act in a conservative, evidence-based, and highly rigorous manner. Extract requirements, risks, opportunities, proposed BOM configurations, and preliminary schedules with exact page and section source references. Avoid hallucinations. If info is missing, mark it as 'requires_customer_confirmation' or 'missing_information'.",
      language: "English",
      version: "v2.1",
      is_active: true,
      created_by: "u1",
      created_at: "2026-01-20T11:00:00Z",
      updated_at: "2026-06-20T14:00:00Z"
    }
  ],
  proposalTemplates: [
    {
      id: "t1",
      name: "Standard Swiss Modern Technical Template",
      description: "Clean, high-contrast display typography designed for engineering bids and public infrastructure proposals.",
      template_type: "technical",
      language: "English",
      file_type: "docx",
      file_path: "/templates/technical_swiss_v1.docx",
      variables_schema: JSON.stringify(["{{project.name}}", "{{project.customer_name}}", "{{analysis.executive_summary}}", "{{analysis.critical_requirements}}", "{{analysis.bom}}"]),
      version: "v3.0",
      active: true,
      default_template: true,
      uploaded_by: "Elena Rostova",
      created_at: "2026-05-10T10:00:00Z",
      updated_at: "2026-06-25T11:00:00Z"
    },
    {
      id: "t2",
      name: "Corporate Commercial Template",
      description: "Includes standard legal definitions, payment structures, validities, and a beautifully structured pricing matrix.",
      template_type: "commercial",
      language: "English",
      file_type: "docx",
      file_path: "/templates/commercial_corporate_v1.docx",
      variables_schema: JSON.stringify(["{{project.name}}", "{{project.customer_name}}", "{{proposal.manual_pricing_table}}", "{{proposal.payment_terms}}"]),
      version: "v2.0",
      active: true,
      default_template: true,
      uploaded_by: "Marcus Vance",
      created_at: "2026-05-12T10:00:00Z",
      updated_at: "2026-06-22T09:30:00Z"
    },
    {
      id: "t3",
      name: "Smart Cities Spanish Technical Template",
      description: "Especificaciones técnicas adaptadas para licitaciones públicas de municipios en España.",
      template_type: "technical",
      language: "Spanish",
      file_type: "docx",
      file_path: "/templates/tecnico_ciudades_inteligentes_v1.docx",
      variables_schema: JSON.stringify(["{{project.name}}", "{{analysis.executive_summary}}"]),
      version: "v1.1",
      active: true,
      default_template: false,
      uploaded_by: "Marcus Vance",
      created_at: "2026-06-18T14:00:00Z",
      updated_at: "2026-06-18T14:00:00Z"
    }
  ],
  proposals: [
    {
      id: "prop1",
      project_id: "p1",
      proposal_type: "technical",
      template_id: "t1",
      template_version: "v3.0",
      status: "released",
      language: "English",
      docx_file_path: "/exports/p1/Technical_Proposal_v1.0.docx",
      pdf_file_path: "/exports/p1/Technical_Proposal_v1.0.pdf",
      generated_by: "Elena Rostova",
      generated_at: "2026-06-20T16:00:00Z",
      version: 1,
      approval_workflow_id: "w1",
    },
    {
      id: "prop2",
      project_id: "p1",
      proposal_type: "commercial",
      template_id: "t2",
      template_version: "v2.0",
      status: "submitted",
      language: "English",
      docx_file_path: "/exports/p1/Commercial_Proposal_v1.0.docx",
      pdf_file_path: "/exports/p1/Commercial_Proposal_v1.0.pdf",
      generated_by: "Marcus Vance",
      generated_at: "2026-07-01T11:00:00Z",
      version: 1,
      approval_workflow_id: "w1",
      manual_pricing_table: [
        {
          item_id: "bom1",
          product_or_service: "CAM-ALPR-10X",
          quantity: 45,
          unit: "units",
          unit_price: 1850.00,
          total_price: 83250.00,
          currency: "USD",
          is_optional: false,
          discount: 10,
        },
        {
          item_id: "bom2",
          product_or_service: "Switch-Hardened-8G",
          quantity: 22,
          unit: "units",
          unit_price: 420.00,
          total_price: 9240.00,
          currency: "USD",
          is_optional: false,
          discount: 5,
        },
        {
          item_id: "bom3",
          product_or_service: "AI-TRAFFIC-LICENSE",
          quantity: 45,
          unit: "licenses",
          unit_price: 350.00,
          total_price: 15750.00,
          currency: "USD",
          is_optional: true,
          discount: 20,
        }
      ],
      payment_terms: "30% upon mobilization, 40% upon hardware delivery and validation on site, 30% upon final MTA sign-off.",
      delivery_terms: "DDP MTA Storage Yard (Incoterms 2026). Expected delivery within 60 days of purchase order.",
      proposal_validity: "90 days from July 1st, 2026 (Valid until October 1st, 2026).",
      commercial_assumptions: "Pricing excludes municipal trenching and fiber conduit laying. MTA is assumed to provide active and stable utility access feeds to cabinet coordinates.",
      exclusions: "Civil engineering trench excavation, pole foundation concrete pour, regional utility electric permits, or Oracle database internal enterprise core licenses."
    }
  ],
  approvalWorkflows: [
    {
      id: "w1",
      name: "High-Value Infrastructure Approval Workflow",
      description: "Rigorous 3-stage validation required for public tenders, infrastructure vertical bids, or any proposal valued over USD 50,000.",
      active: true,
      applies_to: "all",
      stages: [
        {
          id: "w1-s1",
          workflow_id: "w1",
          name: "Pre-Sales Technical Verification",
          order: 1,
          approver_type: "role",
          approver_role_id: "r3", // Pre-Sales Engineer
          mandatory: true,
          conditions: "Always mandatory",
          created_at: "2026-02-15T10:00:00Z",
          updated_at: "2026-02-15T10:00:00Z"
        },
        {
          id: "w1-s2",
          workflow_id: "w1",
          name: "Commercial & Margin Validation",
          order: 2,
          approver_type: "role",
          approver_role_id: "r2", // Sales Manager
          mandatory: true,
          conditions: "Valued > $10,000",
          created_at: "2026-02-15T10:05:00Z",
          updated_at: "2026-02-15T10:05:00Z"
        },
        {
          id: "w1-s3",
          workflow_id: "w1",
          name: "Executive & Director Sign-off",
          order: 3,
          approver_type: "role",
          approver_role_id: "r1", // Admin
          mandatory: true,
          conditions: "Valued > $50,000",
          created_at: "2026-02-15T10:10:00Z",
          updated_at: "2026-02-15T10:10:00Z"
        }
      ],
      created_at: "2026-02-15T10:00:00Z",
      updated_at: "2026-02-15T10:00:00Z"
    },
    {
      id: "w2",
      name: "Standard Smart City Bid Flow",
      description: "Fast-tracked 2-stage verification for smart city vertical contracts.",
      active: true,
      applies_to: "Smart Cities",
      stages: [
        {
          id: "w2-s1",
          workflow_id: "w2",
          name: "Technical Specification Verification",
          order: 1,
          approver_type: "role",
          approver_role_id: "r3",
          mandatory: true,
          conditions: "Always mandatory",
          created_at: "2026-03-01T09:00:00Z",
          updated_at: "2026-03-01T09:00:00Z"
        },
        {
          id: "w2-s2",
          workflow_id: "w2",
          name: "Commercial Approvals",
          order: 2,
          approver_type: "role",
          approver_role_id: "r2",
          mandatory: true,
          conditions: "Always mandatory",
          created_at: "2026-03-01T09:05:00Z",
          updated_at: "2026-03-01T09:05:00Z"
        }
      ],
      created_at: "2026-03-01T09:00:00Z",
      updated_at: "2026-03-01T09:00:00Z"
    }
  ],
  approvalDecisions: [
    {
      id: "dec1",
      proposal_id: "prop1",
      stage_id: "w1-s1",
      approver_user_id: "u3", // Elena (Technical)
      decision: "approved",
      comments: "Technical specification parameters fully align with vehicle analytics expectations.",
      created_at: "2026-06-18T15:00:00Z"
    },
    {
      id: "dec2",
      proposal_id: "prop1",
      stage_id: "w1-s2",
      approver_user_id: "u2", // Marcus (Commercial)
      decision: "approved",
      comments: "Hardened switch margins have been reviewed. Pricing matches core parameters.",
      created_at: "2026-06-19T10:30:00Z"
    },
    {
      id: "dec3",
      proposal_id: "prop1",
      stage_id: "w1-s3",
      approver_user_id: "u1", // Alex (Admin/Director)
      decision: "approved",
      comments: "Released for public submission.",
      created_at: "2026-06-20T14:15:00Z"
    }
  ],
  tasks: [
    {
      id: "t_its1",
      project_id: "p1",
      title: "Confirm concrete poles loading ratings",
      description: "Ask MTA engineering if concrete poles can support the 14kg weight of the dual camera enclosure.",
      owner_user_id: "u3",
      due_date: "2026-07-15",
      status: "open",
      priority: "high",
      related_analysis_item: "req1 (camera mounting requirements)",
      created_by: "u3",
      created_at: "2026-06-12T11:15:00Z",
      updated_at: "2026-06-12T11:15:00Z"
    },
    {
      id: "t_its2",
      project_id: "p1",
      title: "Check fiber conduit dark allocation",
      description: "Confirm splicing slots layout inside Junction Cabinet 4B with transit engineers.",
      owner_user_id: "u3",
      due_date: "2026-07-20",
      status: "in_progress",
      priority: "medium",
      related_analysis_item: "risk2 (freeway fiber limitations)",
      created_by: "u3",
      created_at: "2026-06-12T11:20:00Z",
      updated_at: "2026-07-01T15:30:00Z"
    }
  ],
  brandingSettings: {
    id: "branding-global",
    company_name: "Assistant AI Corp",
    company_logo_path: "",
    login_logo_path: "",
    sidebar_logo_path: "",
    report_logo_path: "",
    favicon_path: "",
    primary_color: "#0f172a", // slate-900
    secondary_color: "#1e293b", // slate-800
    accent_color: "#06b6d4", // cyan-500
    background_color: "#f8fafc", // slate-50
    text_color: "#0f172a", // slate-900
    font_family: "Inter",
    border_radius: "rounded-xl",
    button_style: "solid",
    default_theme: "light",
    custom_css_variables: "",
    footer_text: "Commercial Assistant AI - Enterprise Pre-Sales Solution © 2026",
    support_contact: "support@assistantai-corp.com",
    legal_text: "CONFIDENTIALITY NOTICE: This system handles proprietary and sensitive customer bidding documentation. Unauthorized disclosure of technical specification summaries or commercial tables is strictly prohibited.",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-07-01T16:00:00Z"
  },
  integrationConnectors: [
    {
      id: "int1",
      name: "Salesforce CRM Connector",
      type: "CRM",
      status: "connected",
      configuration: JSON.stringify({ api_version: "v56.0", endpoint: "https://enterprise-salesforce.secure.force.com", sync_frequency: "hourly" }),
      last_sync_status: "SUCCESS",
      last_sync_date: "2026-07-01T16:00:00Z",
      created_at: "2026-01-10T10:00:00Z",
      updated_at: "2026-07-01T16:00:00Z"
    },
    {
      id: "int2",
      name: "HubSpot Sales Suite",
      type: "CRM",
      status: "disconnected",
      configuration: JSON.stringify({ portal_id: "4412093", auto_import_deals: true }),
      last_sync_status: "DISCONNECTED",
      created_at: "2026-02-20T11:00:00Z",
      updated_at: "2026-06-15T09:00:00Z"
    },
    {
      id: "int3",
      name: "SAP ERP Central Gateway",
      type: "ERP",
      status: "error",
      configuration: JSON.stringify({ sap_client: "100", rfc_destination: "S4P_CLNT100", sync_catalog: true }),
      last_sync_status: "FAILED",
      last_sync_date: "2026-06-30T18:00:00Z",
      error_message: "RFC Connection timed out. Please check your enterprise VPN configuration and secure routing lists.",
      created_at: "2026-03-15T14:00:00Z",
      updated_at: "2026-06-30T18:00:00Z"
    }
  ],
  document_contents: {}
};

// Singleton storage loader
class DBStore {
  private data: DBData;

  constructor() {
    this.data = { ...initialData };
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        this.data = JSON.parse(raw);
      } else {
        this.save();
      }
    } catch (e) {
      console.error("Failed to load db_state.json, using defaults", e);
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save db_state.json", e);
    }
  }

  // Generic helper for entities
  public getData(): DBData {
    return this.data;
  }

  // Projects CRUD
  public getProjects(): Project[] {
    return this.data.projects;
  }

  public getProject(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  public createProject(project: Omit<Project, "id" | "created_at" | "updated_at">): Project {
    const newProj: Project = {
      ...project,
      id: "p_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.projects.unshift(newProj);
    this.save();
    return newProj;
  }

  public updateProject(id: string, updates: Partial<Project>): Project | undefined {
    const idx = this.data.projects.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    this.data.projects[idx] = {
      ...this.data.projects[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.projects[idx];
  }

  public deleteProject(id: string): boolean {
    const originalLength = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.data.documents = this.data.documents.filter((d) => d.project_id !== id);
    this.data.analysisResults = this.data.analysisResults.filter((ar) => ar.project_id !== id);
    this.data.proposals = this.data.proposals.filter((pr) => pr.project_id !== id);
    this.data.tasks = this.data.tasks.filter((t) => t.project_id !== id);
    this.save();
    return this.data.projects.length < originalLength;
  }

  // Documents CRUD
  public getDocuments(projectId?: string): Document[] {
    if (projectId) {
      return this.data.documents.filter((d) => d.project_id === projectId);
    }
    return this.data.documents;
  }

  public addDocument(doc: Omit<Document, "id" | "created_at">): Document {
    const newDoc: Document = {
      ...doc,
      id: "doc_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
    };
    this.data.documents.push(newDoc);
    this.save();
    return newDoc;
  }

  public deleteDocument(id: string): boolean {
    const originalLength = this.data.documents.length;
    this.data.documents = this.data.documents.filter((d) => d.id !== id);
    this.save();
    return this.data.documents.length < originalLength;
  }

  // AI Analysis Results
  public getAnalysisResult(projectId: string): AnalysisResult | undefined {
    return this.data.analysisResults.find((ar) => ar.project_id === projectId);
  }

  public saveAnalysisResult(result: AnalysisResult) {
    const idx = this.data.analysisResults.findIndex((ar) => ar.project_id === result.project_id);
    if (idx !== -1) {
      this.data.analysisResults[idx] = {
        ...result,
        updated_at: new Date().toISOString(),
      };
    } else {
      this.data.analysisResults.push(result);
    }
    this.save();
  }

  // AI Jobs
  public getJobs(): AIAnalysisJob[] {
    return this.data.analysisJobs;
  }

  public getJob(id: string): AIAnalysisJob | undefined {
    return this.data.analysisJobs.find((j) => j.id === id);
  }

  public createJob(job: Omit<AIAnalysisJob, "id">): AIAnalysisJob {
    const newJob: AIAnalysisJob = {
      ...job,
      id: "job_" + Math.random().toString(36).substr(2, 9),
    };
    this.data.analysisJobs.unshift(newJob);
    this.save();
    return newJob;
  }

  public updateJob(id: string, updates: Partial<AIAnalysisJob>): AIAnalysisJob | undefined {
    const idx = this.data.analysisJobs.findIndex((j) => j.id === id);
    if (idx === -1) return undefined;
    this.data.analysisJobs[idx] = {
      ...this.data.analysisJobs[idx],
      ...updates,
    };
    this.save();
    return this.data.analysisJobs[idx];
  }

  // Proposals CRUD
  public getProposals(projectId?: string): Proposal[] {
    if (projectId) {
      return this.data.proposals.filter((pr) => pr.project_id === projectId);
    }
    return this.data.proposals;
  }

  public getProposal(id: string): Proposal | undefined {
    return this.data.proposals.find((p) => p.id === id);
  }

  public createProposal(prop: Omit<Proposal, "id" | "generated_at">): Proposal {
    const newProp: Proposal = {
      ...prop,
      id: "prop_" + Math.random().toString(36).substr(2, 9),
      generated_at: new Date().toISOString(),
    };
    this.data.proposals.unshift(newProp);
    this.save();
    return newProp;
  }

  public updateProposal(id: string, updates: Partial<Proposal>): Proposal | undefined {
    const idx = this.data.proposals.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    this.data.proposals[idx] = {
      ...this.data.proposals[idx],
      ...updates,
    };
    this.save();
    return this.data.proposals[idx];
  }

  // Logs
  public getAuditLogs(): AuditLog[] {
    return this.data.auditLogs;
  }

  public addAuditLog(log: Omit<AuditLog, "id" | "created_at">) {
    const newLog: AuditLog = {
      ...log,
      id: "aud_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
    };
    this.data.auditLogs.unshift(newLog);
    // Limit to 1000 items
    if (this.data.auditLogs.length > 1000) {
      this.data.auditLogs.pop();
    }
    this.save();
  }

  public getDebugLogs(): DebugLog[] {
    return this.data.debugLogs;
  }

  public addDebugLog(log: Omit<DebugLog, "id" | "timestamp">) {
    const newLog: DebugLog = {
      ...log,
      id: "dbg_" + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };
    this.data.debugLogs.unshift(newLog);
    // Limit to 1000 items
    if (this.data.debugLogs.length > 1000) {
      this.data.debugLogs.pop();
    }
    this.save();
  }

  // Platform settings
  public getSettings(): PlatformSettings {
    return this.data.platformSettings;
  }

  public updateSettings(updates: Partial<PlatformSettings>): PlatformSettings {
    this.data.platformSettings = {
      ...this.data.platformSettings,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.platformSettings;
  }

  // Branding settings
  public getBranding(): BrandingSettings {
    return this.data.brandingSettings;
  }

  public updateBranding(updates: Partial<BrandingSettings>): BrandingSettings {
    this.data.brandingSettings = {
      ...this.data.brandingSettings,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.brandingSettings;
  }

  // Prompt templates CRUD
  public getPrompts(): PromptTemplate[] {
    return this.data.promptTemplates;
  }

  public updatePrompt(id: string, updates: Partial<PromptTemplate>): PromptTemplate | undefined {
    const idx = this.data.promptTemplates.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    this.data.promptTemplates[idx] = {
      ...this.data.promptTemplates[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.promptTemplates[idx];
  }

  // Proposal templates CRUD
  public getProposalTemplates(): ProposalTemplate[] {
    return this.data.proposalTemplates;
  }

  public createProposalTemplate(tpl: Omit<ProposalTemplate, "id" | "created_at" | "updated_at">): ProposalTemplate {
    const newTpl: ProposalTemplate = {
      ...tpl,
      id: "tpl_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.proposalTemplates.unshift(newTpl);
    this.save();
    return newTpl;
  }

  public updateProposalTemplate(id: string, updates: Partial<ProposalTemplate>): ProposalTemplate | undefined {
    const idx = this.data.proposalTemplates.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    this.data.proposalTemplates[idx] = {
      ...this.data.proposalTemplates[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.proposalTemplates[idx];
  }

  // Approval workflows CRUD
  public getApprovalWorkflows(): ApprovalWorkflow[] {
    return this.data.approvalWorkflows;
  }

  public updateApprovalWorkflow(id: string, updates: Partial<ApprovalWorkflow>): ApprovalWorkflow | undefined {
    const idx = this.data.approvalWorkflows.findIndex((w) => w.id === id);
    if (idx === -1) return undefined;
    this.data.approvalWorkflows[idx] = {
      ...this.data.approvalWorkflows[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.approvalWorkflows[idx];
  }

  // Tasks CRUD
  public getTasks(projectId?: string): Task[] {
    if (projectId) {
      return this.data.tasks.filter((t) => t.project_id === projectId);
    }
    return this.data.tasks;
  }

  public createTask(task: Omit<Task, "id" | "created_at" | "updated_at">): Task {
    const newTask: Task = {
      ...task,
      id: "task_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.tasks.unshift(newTask);
    this.save();
    return newTask;
  }

  public updateTask(id: string, updates: Partial<Task>): Task | undefined {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    this.data.tasks[idx] = {
      ...this.data.tasks[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.tasks[idx];
  }

  public deleteTask(id: string): boolean {
    const originalLength = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.save();
    return this.data.tasks.length < originalLength;
  }

  // Conversation history
  public getConversationHistory(projectId: string): ConversationMessage[] {
    return this.data.conversationHistory.filter((c) => c.project_id === projectId);
  }

  public addConversationMessage(msg: Omit<ConversationMessage, "id" | "created_at">): ConversationMessage {
    const newMsg: ConversationMessage = {
      ...msg,
      id: "msg_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
    };
    this.data.conversationHistory.push(newMsg);
    this.save();
    return newMsg;
  }

  // Integrations connectors
  public getIntegrations(): IntegrationConnector[] {
    return this.data.integrationConnectors;
  }

  public updateIntegration(id: string, updates: Partial<IntegrationConnector>): IntegrationConnector | undefined {
    const idx = this.data.integrationConnectors.findIndex((i) => i.id === id);
    if (idx === -1) return undefined;
    this.data.integrationConnectors[idx] = {
      ...this.data.integrationConnectors[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.integrationConnectors[idx];
  }

  public addIntegration(conn: Omit<IntegrationConnector, "id" | "created_at" | "updated_at">): IntegrationConnector {
    const newConn: IntegrationConnector = {
      ...conn,
      id: "int_" + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.integrationConnectors.push(newConn);
    this.save();
    return newConn;
  }

  public deleteIntegration(id: string): boolean {
    const idx = this.data.integrationConnectors.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.data.integrationConnectors.splice(idx, 1);
    this.save();
    return true;
  }
}

export const dbStore = new DBStore();

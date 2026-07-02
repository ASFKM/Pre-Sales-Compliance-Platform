# pre-Sales Proposal Template & Substitution Guide

The Commercial Assistant AI document compiler (`/server/utils/docx.ts`) provides full support for automated variables and repeating tables. This guide outlines how to format Microsoft Word (`.docx`) pre-sales templates to use this compiler.

---

## 1. Simple Variable Substitutions

The compiler scans the `.docx` file structure and replaces simple placeholders with project and analysis parameters. Place variables in your document using double curly brackets: `{{variable_name}}`.

| Placeholder | Context | Value Source |
|---|---|---|
| `{{project_name}}` | Project Details | Project Name |
| `{{customer_name}}` | Client Metadata | Customer / Client Name |
| `{{project_description}}` | Brief Summary | Project Scope |
| `{{project_vertical}}` | Sector Segment | Business Vertical |
| `{{executive_summary}}` | Compliance Audit | AI-Generated Audit Summary |
| `{{payment_terms}}` | Payment Rules | Manually added terms |
| `{{delivery_terms}}` | Logistics | Manually added delivery rules |
| `{{proposal_validity}}` | Lifespan | Validity period (e.g., "90 Days") |
| `{{exclusions}}` | Out of Scope | Excluded works or products |

---

## 2. Repeating Tables (Arrays)

To list multiple rows (such as Bill of Materials, risk items, or manual pricing tables), create a Microsoft Word table and tag the first row of your data loop. The compiler will dynamically duplicate that table row for every record in the array.

### A. Technical Bill of Materials (BOM) Table
Tag a table row with placeholders to loop through technical items:
- `{{bom.item}}`: Item name or code.
- `{{bom.quantity}}`: Quantity required.
- `{{bom.compliance}}`: Yes/No/Partial compliance rating.
- `{{bom.justification}}`: Pre-sales justification.

### B. Project Risks & Mitigations Table
Tag a table row with placeholders to loop through project risks:
- `{{risk.description}}`: Identified risk.
- `{{risk.severity}}`: Risk classification (Low / Medium / High).
- `{{risk.mitigation}}`: Proposed pre-sales engineering mitigation.

### C. Commercial Pricing Table
Tag a table row with placeholders to loop through manual pricing rows:
- `{{pricing.item}}`: Product or service description.
- `{{pricing.qty}}`: Item quantity.
- `{{pricing.unit}}`: Unit measurement (e.g. "Hour", "Unit").
- `{{pricing.price}}`: Calculated unit price.
- `{{pricing.total}}`: Subtotal price.
- `{{pricing.discount}}`: Percentage discount applied.

---

## 3. Uploading Templates

1. Navigate to the **Templates** tab in the admin or workspace console.
2. Upload your custom-styled Word `.docx` file.
3. Mark it as the "Active" or "Default" template.
4. When generating proposals under any project, the compiler will load this template, inject the parsed variables, compile the PDF, and save it to the project's upload folder.

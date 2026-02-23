# Healthcare MCP Integrations (Plan + Guardrails)

This repo can use MCP to connect JODA to external systems, but healthcare integrations require stricter controls, credential handling, and careful vendor/API selection.

## Guardrails

- Do not auto-install random MCP servers from the internet.
- Keep credentials out of git (use `.env` / secrets managers).
- Treat PHI/PII as sensitive: log redaction, least-privilege access, and audit trails.
- Prefer read-only tooling first (terminology lookup, metadata queries) before write capabilities.

## Recommended Approach

1. **Add known MCP servers** to Codex (`codex mcp add ...`) and enable JODA import:
   - Set `JODA_MCP_IMPORT_CODEX=1` so JODA reuses Codex MCP servers.
2. **Schedule MCP refresh** to re-read config and re-discover tools:
   - Create a scheduler job with `task_type: "mcp_reload"` (cron or interval).
3. **Run automated discovery** to find real MCP servers and capture references:
   - Use JODA tool `healthcare_mcp_discover` or a scheduler job with `task_type: "healthcare_mcp_discovery"`.
   - Outputs are written to `projects/healthcare_mcp_catalog/runs/`.
4. **Build healthcare-specific MCP servers** where no trusted server exists yet (preferred):
   - FHIR, DICOMweb, SNOMED CT, WHO datasets, etc.

## Targets & Typical APIs

### FHIR (R4/R5)
- Standard REST resources: `Patient`, `Encounter`, `Observation`, `MedicationRequest`, etc.
- MCP server should wrap: search, read, validate, and optional create/update with strict scopes.

### DICOM / PACS (DICOMweb)
- Prefer DICOMweb endpoints:
  - QIDO-RS (query)
  - WADO-RS (retrieve)
  - STOW-RS (store)
- MCP server should support metadata retrieval and viewer integration hooks.

### SNOMED CT (Terminology)
- Typically via a terminology server (e.g., Snowstorm) or vendor terminology APIs.
- MCP server should support concept lookup, hierarchy queries, and mapping workflows.

### Epic / Cerner (Oracle Health)
- Usually exposed via SMART on FHIR / vendor gateways, OAuth2, and strict scopes.
- A dedicated MCP server should handle auth flows and tenant config.

### Doctor Worklists
- Often a vendor-specific API; sometimes FHIR-based (e.g., `Task` resource).
- MCP server should focus on listing/triaging tasks and generating summaries.

### WHO / DSM
- WHO datasets vary by product; DSM licensing applies (be careful).
- MCP server should be read-only and cite sources/licensing constraints.

## “Newest MCP servers” discovery (Safe pattern)

Instead of auto-installing, maintain an allowlist file (future work) that names vetted servers and the exact `codex mcp add ...` command. Then a scheduled job can:
- `mcp_reload` (always safe)
- optionally compare allowlist vs Codex config and suggest additions for human approval

If you want to crawl a public MCP directory for candidates, use the discovery workflow that writes a reviewable catalog:
- Tool: `mcp_directory_discover`
- Outputs: `projects/mcp_directory_catalog/runs/`

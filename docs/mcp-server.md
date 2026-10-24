# SecureFlow Threat Intelligence MCP Server

The SecureFlow CLI includes a built-in **Model Context Protocol (MCP)** server (`cli/src/mcp/index.ts`) that exposes real-time threat intelligence advisories, CVE/CWE vulnerability remediation guidance, and cryptographic intent verification to AI coding assistants and IDE agents over standard I/O (`stdio`).

By connecting your AI agent (such as **Cursor**, **Claude Desktop**, or **Windsurf**) to the SecureFlow MCP server, the model can look up verified security advisories, identify known vulnerabilities, and validate proposed fixes against ArmorIQ security boundaries while writing code.

---

## Architecture Overview

```text
┌──────────────────────────────────────────────┐
│       IDE Agent / AI Assistant               │
│  (Cursor, Claude Desktop, Windsurf, etc.)   │
└──────────────────────┬───────────────────────┘
                       │ JSON-RPC 2.0 (stdio)
                       ▼
┌──────────────────────────────────────────────┐
│           SecureFlow CLI MCP Server          │
│             `secureflow mcp`                 │
├──────────────────────────────────────────────┤
│ 🛡️ ArmorIQ Cryptographic Intent Verification  │
│    - Fail-closed prompt injection filter    │
│    - HMAC-SHA256 execution proof signing    │
├──────────────────────────────────────────────┤
│ 📚 Live Threat Intelligence Knowledge Base   │
│    - CVE lookups & CWE categorization        │
│    - Actionable remediation code patterns   │
└──────────────────────────────────────────────┘
```

The server operates locally via `stdio` using `@modelcontextprotocol/sdk`, requiring no external ports or network ingress.

---

## Available MCP Tools

The server registers two primary tools exposed via `ListToolsRequestSchema`:

### 1. `query_threat_intelligence`

Searches the threat intelligence knowledge base for security advisories matching keywords, vulnerability classes, or CVE IDs.

- **Parameters**:
  - `query` (`string`, **required**): Search keyword, vulnerability type, or CVE identifier (e.g., `"SQL injection"`, `"SSRF"`, `"CVE-2023-3409"`, `"secret logging"`).
  - `intentToken` (`string`, _optional_): Cryptographic intent token declaring an approved plan for ArmorIQ verification.
- **Returns**: A JSON array of matching `ThreatIntelligenceEntry` objects containing `id`, `category`, `description`, `severity`, `cve`, and `remediationGuidance`. If no direct match is found, representative defensive advisories are returned.

### 2. `lookup_cve`

Retrieves detailed vulnerability information, severity rating, and concrete remediation instructions for an exact CVE or CWE identifier.

- **Parameters**:
  - `cveId` (`string`, **required**): The CVE or CWE identifier (e.g., `"CVE-2023-3409"`, `"CVE-2023-28154"`, `"CWE-79"`, `"CWE-94"`). Case-insensitive.
  - `intentToken` (`string`, _optional_): Cryptographic intent token declaring an approved plan for ArmorIQ verification.
- **Returns**: A JSON object with the full threat advisory and remediation guidance, or an error payload with defensive programming recommendations if the identifier is not in the local database.

---

## ArmorIQ Cryptographic Intent Verification

All MCP tool invocations are gated by the `verifyDeclaredIntent` boundary filter before execution to prevent prompt injection and unauthorized actions:

1. **Adversarial Prompt Injection Defense (CWE-94)**:
   - Evaluates arguments against known adversarial patterns, such as system overrides, jailbreak phrases (`"ignore previous instructions"`, `"system override"`), and attempts to exfiltrate private tokens or credentials (`"exfiltrate secret"`, `"leak intent token"`, `ARMORIQ_API_KEY`).
   - If detected, execution halts **fail-closed** and returns an error:
     ```json
     {
       "error": "Action blocked by ArmorIQ: Adversarial prompt injection (CWE-94) detected",
       "code": "ARMORIQ_INTENT_VERIFICATION_FAILED",
       "enforcement": "FAIL_CLOSED"
     }
     ```

2. **Cryptographic Intent Tokens**:
   - If an `intentToken` is supplied, it is validated for tamper resistance (minimum length of 16 characters and absence of tampering flags).
   - The server computes a SHA-256 hash over `{ toolName, args, timestamp }` and signs it using HMAC-SHA256 with `ARMORIQ_PROOF_SIGNING_KEY`.

---

## Environment Variables

| Variable                    | Default         | Purpose                                                                  |
| :-------------------------- | :-------------- | :----------------------------------------------------------------------- |
| `ARMORIQ_PROOF_SIGNING_KEY` | none (required) | Secret key used to sign execution proofs and verify intent authenticity. |

---

## IDE & Client Configuration

You can launch the MCP server globally via `npx`, through a global `npm install`, or directly from a local repository checkout.

### Option A: Cursor

Cursor supports MCP servers configured via workspace `.cursor/mcp.json` or user-level settings.

#### Workspace Configuration (`.cursor/mcp.json`)

Create or update `.cursor/mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "secureflow": {
      "command": "npx",
      "args": ["-y", "secureflow-cli", "mcp"],
      "env": {
        "ARMORIQ_PROOF_SIGNING_KEY": "your-custom-intent-signing-key"
      }
    }
  }
}
```

#### Settings UI:

1. Open **Cursor Settings** (`Cmd + ,` or `Ctrl + ,`).
2. Navigate to **Features** -> **MCP Servers**.
3. Click **Add New MCP Server**.
4. Set **Name** to `secureflow`.
5. Set **Type** to `stdio`.
6. Set **Command** to:
   ```text
   npx -y secureflow-cli mcp
   ```

---

### Option B: Claude Desktop

Claude Desktop configures MCP servers in `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the `secureflow` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "secureflow": {
      "command": "npx",
      "args": ["-y", "secureflow-cli", "mcp"],
      "env": {
        "ARMORIQ_PROOF_SIGNING_KEY": "your-custom-intent-signing-key"
      }
    }
  }
}
```

---

### Option C: Windsurf

Configure Windsurf via `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "secureflow": {
      "command": "npx",
      "args": ["-y", "secureflow-cli", "mcp"]
    }
  }
}
```

---

### Option D: Local Development / Monorepo Build

If you are developing inside the SecureFlow repository or testing local modifications:

1. Build the CLI package:

   ```bash
   cd cli
   npm run build
   ```

2. Point your IDE configuration to the compiled entrypoint:
   ```json
   {
     "mcpServers": {
       "secureflow-local": {
         "command": "node",
         "args": ["/absolute/path/to/SecureFlow/cli/dist/index.js", "mcp"]
       }
     }
   }
   ```

---

## Verifying the Server Manually

You can test that the MCP server starts correctly by running it from your terminal:

```bash
npx -y secureflow-cli mcp
```

The server writes diagnostics to `stderr` and listens for JSON-RPC messages on `stdin`:

```text
SecureFlow Threat Intelligence MCP Server running via stdio
```

You can send a test JSON-RPC initialize request via `stdin`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "test-client", "version": "1.0.0" }
  }
}
```

---

## Example Agent Prompts

Once configured, your AI coding assistant can leverage the MCP server autonomously:

- _"Check the threat intelligence database for CVE-2023-3409 and give me the recommended remediation for our database queries."_
- _"We are building an outbound webhook caller. Query the threat intelligence server for SSRF vulnerabilities and best practices."_
- _"Look up CWE-79 and check if our template escaping implementation matches recommended guidelines."_

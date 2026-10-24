/**
 * ArmorIQ Agent Registry & Policy Definitions (#1275)
 *
 * Provides centralized onboarding and organizational policy definitions for
 * SecureFlow AI workers (remediation patch generator, explanation streamer, etc.).
 * Whitelists allowed tools, scopes, and maps compliance frameworks (SOC 2, GDPR, NIST).
 */

export interface AgentPolicyDefinition {
  agentId: string;
  name: string;
  description: string;
  allowedTools: string[];
  allowedScopes: string[];
  deniedTools: string[];
  complianceFrameworks: string[];
  requireCryptographicIntent: boolean;
}

export const ARMORIQ_AGENT_IDS = {
  REMEDIATION_PATCH_GENERATOR: "agent-remediation-patch-generator",
  SECURITY_EXPLANATION_STREAMER: "agent-security-explanation-streamer",
  HEIST_TRANSMISSION: "agent-heist-transmission",
} as const;

export const DEFAULT_AGENT_POLICIES: Record<string, AgentPolicyDefinition> = {
  [ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR]: {
    agentId: ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
    name: "Automated Patch Remediation Generator",
    description:
      "Generates unified diff patches for detected vulnerabilities within scoped repository boundaries.",
    allowedTools: [
      "queryLiveThreatIntelligence",
      "generateUnifiedDiff",
      "fs.read",
      "mcp.threat_intel",
    ],
    allowedScopes: ["src/**", "tools/**"],
    deniedTools: ["shell.exec", "github.push", "github.pull_request.merge", "fs.write.arbitrary"],
    complianceFrameworks: [
      "SOC 2 (CC6.1 - Logical Access)",
      "GDPR (Art. 32 - Security of Processing)",
      "NIST SP 800-53 (AC-3 - Access Enforcement, AU-2 - Event Logging)",
    ],
    requireCryptographicIntent: true,
  },
  [ARMORIQ_AGENT_IDS.SECURITY_EXPLANATION_STREAMER]: {
    agentId: ARMORIQ_AGENT_IDS.SECURITY_EXPLANATION_STREAMER,
    name: "Security Explanation Streamer",
    description:
      "Generates structured threat narratives and contextual explanations for security findings.",
    allowedTools: [
      "generateExplanation",
      "readCodeSnippet",
      "readFinding",
      "queryLiveThreatIntelligence",
    ],
    allowedScopes: ["read:findings", "read:snippets"],
    deniedTools: ["shell.exec", "fs.write", "github.push", "github.pull_request.merge"],
    complianceFrameworks: [
      "SOC 2 (CC6.1 - Logical Access)",
      "NIST SP 800-53 (AC-3 - Access Enforcement)",
    ],
    requireCryptographicIntent: true,
  },
  [ARMORIQ_AGENT_IDS.HEIST_TRANSMISSION]: {
    agentId: ARMORIQ_AGENT_IDS.HEIST_TRANSMISSION,
    name: "Heist Transmission Public Agent",
    description: "Generates stylized public victory broadcasts and screens project labels.",
    allowedTools: ["screenProjectName", "screenTransmission"],
    allowedScopes: ["transmission:broadcast"],
    deniedTools: ["shell.exec", "fs.write", "fs.read", "github.*"],
    complianceFrameworks: ["NIST SP 800-53 (SI-10 - Information Input Validation)"],
    requireCryptographicIntent: true,
  },
};

class ArmorIQAgentRegistry {
  private policies: Map<string, AgentPolicyDefinition>;

  constructor() {
    this.policies = new Map(Object.entries(DEFAULT_AGENT_POLICIES));
  }

  /**
   * Register or update an agent policy definition.
   */
  register(policy: AgentPolicyDefinition): void {
    this.policies.set(policy.agentId, policy);
  }

  /**
   * Retrieve policy for a given agent.
   */
  get(agentId: string): AgentPolicyDefinition | undefined {
    return this.policies.get(agentId);
  }

  /**
   * List all registered agent policies.
   */
  listAll(): AgentPolicyDefinition[] {
    return Array.from(this.policies.values());
  }

  /**
   * Validates whether a requested tool and scope is whitelisted for the agent.
   */
  validateToolCall(
    agentId: string,
    toolName: string,
    targetScope?: string,
  ): { allowed: boolean; reason: string; rule: string } {
    const policy = this.get(agentId);
    if (!policy) {
      return {
        allowed: false,
        reason: `Agent '${agentId}' is not registered in ArmorIQ policy registry (Zero-Trust Default Deny).`,
        rule: "deny:unregistered_agent",
      };
    }

    const toolLower = toolName.toLowerCase();

    // 1. Explicit denial checks
    for (const denied of policy.deniedTools) {
      if (denied === "*" || denied.toLowerCase() === toolLower) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' is explicitly blocked for agent '${policy.name}'.`,
          rule: "deny:policy_disallowed_tool",
        };
      }
      if (denied.endsWith(".*")) {
        const prefix = denied.slice(0, -2).toLowerCase();
        if (toolLower.startsWith(prefix)) {
          return {
            allowed: false,
            reason: `Tool '${toolName}' matches prohibited category '${denied}'.`,
            rule: "deny:policy_disallowed_tool_category",
          };
        }
      }
    }

    // 2. Allowed tool whitelist check
    const isWhitelisted = policy.allowedTools.some(
      (allowed) => allowed === "*" || allowed.toLowerCase() === toolLower,
    );

    if (!isWhitelisted) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not in the allowed whitelist for agent '${policy.name}'.`,
        rule: "deny:unwhitelisted_tool",
      };
    }

    // 3. Scope validation if target scope provided
    if (targetScope && policy.allowedScopes.length > 0) {
      const scopeAllowed = policy.allowedScopes.some((pattern) => {
        if (pattern === "*") return true;
        if (pattern.endsWith("/**")) {
          const prefix = pattern.slice(0, -3);
          // `src/**` covers `src/` and everything below it, but not a sibling
          // such as `src-evil/`. A bare startsWith(prefix) accepted that.
          return targetScope === prefix || targetScope.startsWith(`${prefix}/`);
        }
        // A non-wildcard scope is an exact capability name. Prefix matching let
        // `read:findings` approve `read:findings-evil`.
        return targetScope === pattern;
      });

      if (!scopeAllowed) {
        return {
          allowed: false,
          reason: `Target scope '${targetScope}' is outside allowed scopes for agent '${policy.name}'.`,
          rule: "deny:out_of_scope_access",
        };
      }
    }

    return {
      allowed: true,
      reason: `Tool '${toolName}' permitted under ArmorIQ policy for agent '${policy.name}'.`,
      rule: "allow:whitelisted_tool",
    };
  }
}

export const agentRegistry = new ArmorIQAgentRegistry();

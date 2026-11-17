import type { AgentCard, AgentSkill } from "@a2a-js/sdk";

import { configuredUrl, normalizeTrustedBaseUrl, normalizeTrustedPath } from "./url";

export const A2A_REGISTRY_SCHEMA_VERSION = 1;
export const SUPPORTED_A2A_PROTOCOL_VERSION = "1.0";
export const A2A_AUTH_SCHEME = "Bearer";
export const A2A_AUTH_SECURITY_SCHEME_ID = "bearerAuth";

export interface ConfiguredA2AAgent {
  /** Stable logical expert identifier. It is not generated from model output. */
  id: string;
  name: string;
  description: string;
  /** Host application version for this logical agent/card. */
  agentVersion: string;
  /** Absolute path for this agent's JSON-RPC endpoint. */
  endpointPath: string;
  /** Absolute path for this agent's discovery card. */
  cardPath: string;
  inputModes?: string[];
  outputModes?: string[];
  /** Concrete logical capabilities advertised through discovery. */
  skills: AgentSkill[];
  /** Only set true when the injected executor supports streaming execution. */
  streaming?: boolean;
}

export interface A2AAgentRegistryConfig {
  schemaVersion: 1;
  /** Trusted configured origin/base URL. The registry never discovers model-supplied URLs. */
  publicBaseUrl: string;
  agents: ConfiguredA2AAgent[];
}

interface RegisteredA2AAgent extends ConfiguredA2AAgent {
  endpointUrl: string;
  cardUrl: string;
  normalizedInputModes: string[];
  normalizedOutputModes: string[];
}

export interface RegisteredA2AAgentSnapshot extends ConfiguredA2AAgent {
  endpointUrl: string;
  cardUrl: string;
}

const agentIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function requireNonempty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function normalizeModes(modes: string[] | undefined, fallback: string[], field: string): string[] {
  const result = modes ?? fallback;
  if (!Array.isArray(result) || result.length === 0 || result.some((mode) => typeof mode !== "string" || mode.trim() === "")) {
    throw new Error(`${field} must contain at least one non-empty media type`);
  }
  return [...new Set(result)];
}

function snapshot(agent: RegisteredA2AAgent): RegisteredA2AAgentSnapshot {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    agentVersion: agent.agentVersion,
    endpointPath: agent.endpointPath,
    cardPath: agent.cardPath,
    inputModes: [...agent.normalizedInputModes],
    outputModes: [...agent.normalizedOutputModes],
    skills: structuredClone(agent.skills),
    streaming: agent.streaming,
    endpointUrl: agent.endpointUrl,
    cardUrl: agent.cardUrl,
  };
}

/**
 * Immutable, versioned registry of trusted logical A2A agents. One deployment
 * can expose multiple cards and endpoints without deploying each expert separately.
 */
export class A2AAgentCardRegistry {
  private readonly agents = new Map<string, RegisteredA2AAgent>();
  private readonly endpointPaths = new Map<string, string>();
  private readonly cardPaths = new Map<string, string>();
  private readonly baseUrl: URL;

  constructor(config: A2AAgentRegistryConfig) {
    if (config?.schemaVersion !== A2A_REGISTRY_SCHEMA_VERSION) {
      throw new Error(`Unsupported A2A registry schema version: ${String(config?.schemaVersion)}`);
    }
    this.baseUrl = normalizeTrustedBaseUrl(config.publicBaseUrl, "publicBaseUrl");
    if (!Array.isArray(config.agents) || config.agents.length === 0) {
      throw new Error("At least one configured A2A agent is required");
    }
    for (const agent of config.agents) {
      requireNonempty(agent?.id, "agent id");
      if (!agentIdPattern.test(agent.id)) {
        throw new Error(`Invalid A2A agent id: ${agent.id}`);
      }
      if (this.agents.has(agent.id)) {
        throw new Error(`Duplicate A2A agent id: ${agent.id}`);
      }
      requireNonempty(agent.name, `${agent.id}.name`);
      requireNonempty(agent.description, `${agent.id}.description`);
      requireNonempty(agent.agentVersion, `${agent.id}.agentVersion`);
      const endpointPath = normalizeTrustedPath(agent.endpointPath, `${agent.id}.endpointPath`);
      const cardPath = normalizeTrustedPath(agent.cardPath, `${agent.id}.cardPath`);
      if (!Array.isArray(agent.skills) || agent.skills.length === 0) {
        throw new Error(`${agent.id}.skills must contain at least one logical skill`);
      }
      const existingEndpointAgent = this.endpointPaths.get(endpointPath);
      if (existingEndpointAgent) throw new Error(`Duplicate endpoint path ${endpointPath}`);
      const existingCardAgent = this.cardPaths.get(cardPath);
      if (existingCardAgent) throw new Error(`Duplicate card path ${cardPath}`);
      const registered: RegisteredA2AAgent = {
        ...agent,
        endpointPath,
        cardPath,
        skills: structuredClone(agent.skills),
        endpointUrl: configuredUrl(this.baseUrl, endpointPath),
        cardUrl: configuredUrl(this.baseUrl, cardPath),
        normalizedInputModes: normalizeModes(agent.inputModes, ["text/plain"], `${agent.id}.inputModes`),
        normalizedOutputModes: normalizeModes(agent.outputModes, ["text/plain"], `${agent.id}.outputModes`),
      };
      this.agents.set(agent.id, registered);
      this.endpointPaths.set(endpointPath, agent.id);
      this.cardPaths.set(cardPath, agent.id);
    }
  }

  /** Returns a registry whose advertised absolute URLs use a new trusted base, preserving configuration. */
  withBaseUrl(publicBaseUrl: string): A2AAgentCardRegistry {
    return new A2AAgentCardRegistry({
      schemaVersion: A2A_REGISTRY_SCHEMA_VERSION,
      publicBaseUrl,
      agents: [...this.agents.values()].map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        agentVersion: agent.agentVersion,
        endpointPath: agent.endpointPath,
        cardPath: agent.cardPath,
        inputModes: agent.normalizedInputModes,
        outputModes: agent.normalizedOutputModes,
        skills: structuredClone(agent.skills),
        streaming: agent.streaming,
      })),
    });
  }

  list(): RegisteredA2AAgentSnapshot[] {
    return [...this.agents.values()].map(snapshot);
  }

  get(agentId: string): RegisteredA2AAgentSnapshot {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown configured A2A agent: ${agentId}`);
    return snapshot(agent);
  }

  resolveByEndpointPath(pathname: string): RegisteredA2AAgentSnapshot | undefined {
    const agentId = this.endpointPaths.get(pathname);
    return agentId ? this.get(agentId) : undefined;
  }

  resolveByCardPath(pathname: string): RegisteredA2AAgentSnapshot | undefined {
    const agentId = this.cardPaths.get(pathname);
    return agentId ? this.get(agentId) : undefined;
  }

  getCard(agentId: string): AgentCard {
    const agent = this.get(agentId);
    return {
      name: agent.name,
      description: agent.description,
      supportedInterfaces: [
        {
          url: agent.endpointUrl,
          protocolBinding: "JSONRPC",
          tenant: "",
          protocolVersion: SUPPORTED_A2A_PROTOCOL_VERSION,
        },
      ],
      provider: undefined,
      version: agent.agentVersion,
      capabilities: {
        streaming: agent.streaming === true,
        pushNotifications: false,
        extensions: [],
        extendedAgentCard: false,
      },
      securitySchemes: {
        [A2A_AUTH_SECURITY_SCHEME_ID]: {
          scheme: {
            $case: "httpAuthSecurityScheme",
            value: {
              description: "Host-validated HTTP Bearer authentication",
              scheme: A2A_AUTH_SCHEME,
              bearerFormat: "",
            },
          },
        },
      },
      securityRequirements: [
        {
          schemes: {
            [A2A_AUTH_SECURITY_SCHEME_ID]: { list: [] },
          },
        },
      ],
      defaultInputModes: [...(agent.inputModes ?? [])],
      defaultOutputModes: [...(agent.outputModes ?? [])],
      skills: structuredClone(agent.skills),
      signatures: [],
    };
  }
}

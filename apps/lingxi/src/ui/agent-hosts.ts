// Host identity shared by panel navigation and brand marks.
export const AGENT_HOSTS = [
  { id: 'claude', aliases: ['claude'] },
  { id: 'codex', aliases: ['codex'] },
  { id: 'dsh', aliases: ['dsh', 'deepseek', 'harness'] },
  { id: 'workbuddy', aliases: ['workbuddy', 'codebuddy'] },
  { id: 'doubao', aliases: ['doubao', '豆包'] },
  { id: 'cursor', aliases: ['cursor'] },
] as const;

export type AgentHost = typeof AGENT_HOSTS[number]['id'];

export function resolveAgentHost(identity: string): AgentHost | undefined {
  const normalized = identity.toLowerCase();
  return AGENT_HOSTS.find((host) => host.aliases.some((alias) => normalized.includes(alias)))?.id;
}

export type AgentRole = 'coordinator' | 'researcher' | 'developer' | 'reviewer';
export type AgentProvider = 'inherit' | 'gemini' | 'openai' | 'anthropic' | 'custom' | 'local';
export interface OfficeAgent {
  id: string; name: string; role: AgentRole; provider: AgentProvider; model: string;
  baseUrl: string; instructions: string; enabled: boolean; hasKey?: boolean; apiKey?: string; supportsTools?: boolean;
  skillIds?: string[];
  skillPresetVersion?: number;
}
export interface OfficeTask {
  id: string; agentId: string; title: string; instructions: string; dependsOn: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; output: string; error?: string;
}
export interface OfficeArtifact { id: string; path: string; content: string; originalHash: string; applied: boolean; review?: { verdict: 'approved' | 'changes_requested'; summary: string; reviewedHash: string; at: string; testsExecuted: false } }
export interface OfficeRun {
  focusFile?: string;
  id: string; prompt: string; workspace: string; status: 'planning' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: string; updatedAt: string; tasks: OfficeTask[]; result: string; error?: string;
  events: { at: string; agent: string; message: string }[]; tokens: number; calls: number; artifacts: OfficeArtifact[];
}
export const ROLE_LABELS: Record<AgentRole, string> = { coordinator: 'Koordinatör', researcher: 'Araştırmacı', developer: 'Geliştirici', reviewer: 'Denetçi' };
export const DEFAULT_AGENTS: OfficeAgent[] = (Object.entries(ROLE_LABELS) as [AgentRole, string][]).map(([role, name]) => ({
  id: role, name, role, provider: 'inherit', model: '', baseUrl: '', instructions: '', enabled: true,
}));

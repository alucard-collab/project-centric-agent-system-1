export type ModelTarget = 'local' | 'cloud';
export type ApiType = 'ollama' | 'openai';

export interface ModelPolicy {
  conductor?: ModelTarget;
  junior?: ModelTarget;
  senior?: ModelTarget;
  [agentId: string]: ModelTarget | undefined;
}

export interface PcasConfig {
  localUrl: string;
  apiType: ApiType;
  cloudApiKey: string;
  defaultModel: ModelTarget;
  localModelName: string;
  modelPolicy: ModelPolicy;
  requestTimeout: number;
  knowledgeDir: string;
}

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  dir: string;
}

export interface LogEntry {
  timestamp: string;
  from: string;
  role: 'conductor' | 'junior' | 'senior' | 'system' | 'user';
  content: string;
}

export interface ChannelLogs {
  channelId: string;
  name: string;
  logs: LogEntry[];
}

export interface TaskPlan {
  brief: string;
  channelName: string;
  tasks: Array<{
    agent: string;
    task: string;
  }>;
}

export interface BridgeMessage {
  header: {
    channelId: string;
    from: string;
    to: string;
    returnAddress?: string;
  };
  payload: {
    task: string;
    context: string;
    artifacts: string[];
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ConductorResponse =
  | { type: 'message'; content: string }
  | { type: 'plan'; plan: TaskPlan; summary: string };

export interface ChannelStatus {
  channelId: string;
  channelName: string;
  currentTask: number;
  totalTasks: number;
  stage: 'junior' | 'senior' | 'revision' | 'escalation' | 'completed';
  agent: string;
  attempt: number;
  lastUpdate: string;
  summary: string;
}

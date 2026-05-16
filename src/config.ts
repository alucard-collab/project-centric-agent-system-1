import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PcasConfig, ModelTarget, ModelPolicy, ApiType } from './types';

function defaultKnowledgeDir(): string {
  return path.join(os.homedir(), '.pcas-knowledge');
}

export function getAgentsDir(knowledgeDir: string): string {
  return path.join(knowledgeDir, 'agents');
}

export function getConfig(): PcasConfig {
  const cfg = vscode.workspace.getConfiguration('pcas');
  return {
    localUrl:       cfg.get<string>('localUrl', 'http://127.0.0.1:11434'),
    apiType:        cfg.get<ApiType>('apiType', 'ollama'),
    cloudApiKey:    cfg.get<string>('cloudApiKey', ''),
    defaultModel:   cfg.get<ModelTarget>('defaultModel', 'local'),
    localModelName: cfg.get<string>('localModelName', ''),
    modelPolicy:    cfg.get<ModelPolicy>('modelPolicy', {}),
    requestTimeout: cfg.get<number>('requestTimeout', 300),
    knowledgeDir:   cfg.get<string>('knowledgeDir', '') || defaultKnowledgeDir(),
  };
}

export function getModelForAgent(agentId: string, config: PcasConfig): ModelTarget {
  return config.modelPolicy[agentId] ?? config.defaultModel;
}

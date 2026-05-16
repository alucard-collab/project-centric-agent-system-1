import * as fs from 'fs';
import * as path from 'path';
import { PcasConfig } from '../types';
import { getModelForAgent } from '../config';
import { callLocalLlm } from '../llm';

const FALLBACK_PROMPT = `당신은 Junior 에이전트입니다. 빠르게 초안을 작성하세요.
시니어 피드백이 있으면 반드시 반영하여 수정하세요.`;

export class JuniorAgent {
  private systemPrompt: string;

  constructor(private config: PcasConfig, agentsDir: string, specialistId: string) {
    const promptPath = path.join(agentsDir, specialistId, 'junior.md');
    this.systemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : FALLBACK_PROMPT;
  }

  async execute(task: string, context: string): Promise<string> {
    const userMessage = context.trim()
      ? `${task}\n\n## 컨텍스트\n${context}`
      : task;
    return this.call(userMessage);
  }

  async revise(task: string, previousOutput: string, feedback: string, context: string): Promise<string> {
    const userMessage = `## 작업\n${task}

## 이전 결과물
${previousOutput}

## 시니어 피드백 (반드시 전부 반영)
${feedback}
${context.trim() ? `\n## 컨텍스트\n${context}` : ''}`;
    return this.call(userMessage);
  }

  private async call(userMessage: string): Promise<string> {
    const modelTarget = getModelForAgent('junior', this.config);
    if (modelTarget === 'cloud') {
      throw new Error('Junior 클라우드 모델 미구현 (Phase 5)');
    }
    return callLocalLlm(
      [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
      this.config
    );
  }
}

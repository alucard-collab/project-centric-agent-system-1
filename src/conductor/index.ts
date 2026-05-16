import * as fs from 'fs';
import * as path from 'path';
import { TaskPlan, PcasConfig, ConversationMessage, ConductorResponse } from '../types';
import { getModelForAgent } from '../config';
import { callLocalLlm, detectLocalModel, ChatMessage } from '../llm';
import { ExistingAgent } from '../agents/hr';

export class ConductorAgent {
  private baseSystemPrompt: string;

  constructor(private config: PcasConfig, private agentsDir: string) {
    const promptPath = path.join(agentsDir, 'conductor', 'conductor.md');
    this.baseSystemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : 'You are a conductor. Output JSON only: {"type":"message","content":"..."} or {"type":"plan",...}';
  }

  scanSpecialists(): string[] {
    const excluded = new Set(['conductor', 'hr']);
    if (!fs.existsSync(this.agentsDir)) return [];

    return fs.readdirSync(this.agentsDir, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() &&
        !excluded.has(entry.name) &&
        fs.existsSync(path.join(this.agentsDir, entry.name, 'junior.md')) &&
        fs.existsSync(path.join(this.agentsDir, entry.name, 'senior.md'))
      )
      .map(entry => entry.name);
  }

  readExistingAgents(): ExistingAgent[] {
    return this.scanSpecialists().map(id => ({
      specialistId: id,
      juniorPrompt: fs.readFileSync(path.join(this.agentsDir, id, 'junior.md'), 'utf-8'),
      seniorPrompt: fs.readFileSync(path.join(this.agentsDir, id, 'senior.md'), 'utf-8'),
    }));
  }

  async chat(
    message: string,
    history: ConversationMessage[],
    statusContext = ''
  ): Promise<ConductorResponse> {
    const specialists = this.scanSpecialists();
    const systemPrompt = this.buildSystemPrompt(specialists) + statusContext;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({
        role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    const modelTarget = getModelForAgent('conductor', this.config);
    if (modelTarget === 'cloud') {
      throw new Error('클라우드 모델 미구현. Phase 5 구현 후 사용 가능합니다.');
    }

    const model = this.config.localModelName || await detectLocalModel(this.config);
    const raw = await callLocalLlm(messages, this.config, model);
    return this.parseConductorResponse(raw);
  }

  async plan(userRequest: string, sharedMemory: string): Promise<TaskPlan> {
    const resp = await this.chat(userRequest, [], sharedMemory.trim() ? `\n\n## 채널 컨텍스트\n${sharedMemory}` : '');
    if (resp.type === 'plan') return resp.plan;
    throw new Error(`Conductor가 계획 대신 메시지를 반환했습니다: ${resp.content}`);
  }

  private buildSystemPrompt(specialists: string[]): string {
    const agentList = specialists.length > 0
      ? specialists.map(id => `- **${id}**`).join('\n')
      : '(현재 등록된 에이전트 없음)';

    const marker = '## 전문 에이전트 목록';
    const nextSection = /\n## /;
    const markerIdx = this.baseSystemPrompt.indexOf(marker);

    if (markerIdx === -1) {
      return `${this.baseSystemPrompt}\n\n## 현재 사용 가능한 에이전트\n${agentList}`;
    }

    const afterMarker = this.baseSystemPrompt.slice(markerIdx + marker.length);
    const nextIdx = afterMarker.search(nextSection);
    const rest = nextIdx === -1 ? '' : afterMarker.slice(nextIdx);

    return (
      this.baseSystemPrompt.slice(0, markerIdx) +
      `${marker}\n각 에이전트는 내부적으로 Junior(실행)와 Senior(검토) 쌍으로 작동합니다.\n\n${agentList}` +
      rest
    );
  }

  private parseConductorResponse(raw: string): ConductorResponse {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { type: 'message', content: raw.trim() };
    }
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.type === 'plan' && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        return {
          type: 'plan',
          plan: {
            brief: parsed.brief ?? '',
            channelName: parsed.channelName ?? 'task',
            tasks: parsed.tasks,
          },
          summary: parsed.summary ?? parsed.brief ?? '',
        };
      }
      if (parsed.type === 'hr' && parsed.reason) {
        return { type: 'hr', reason: parsed.reason };
      }
      if (parsed.content) {
        return { type: 'message', content: parsed.content };
      }
      return { type: 'message', content: raw.trim() };
    } catch {
      return { type: 'message', content: raw.trim() };
    }
  }
}

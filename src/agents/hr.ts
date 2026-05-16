import * as fs from 'fs';
import * as path from 'path';
import { PcasConfig, ConversationMessage, HrChatResponse } from '../types';
import { callLocalLlm } from '../llm';

export interface ExistingAgent {
  specialistId: string;
  juniorPrompt: string;
  seniorPrompt: string;
}

const FALLBACK_PROMPT = `당신은 HR 에이전트입니다. 사용자와 대화하여 필요한 전문 에이전트를 파악하고 생성하세요.
완료 시 반드시 JSON으로만 출력하세요.`;

export class HrAgent {
  private systemPrompt: string;

  constructor(private config: PcasConfig, private agentsDir: string) {
    const promptPath = path.join(agentsDir, 'hr', 'hr.md');
    this.systemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : FALLBACK_PROMPT;
  }

  async chat(
    message: string,
    history: ConversationMessage[],
    existingAgents: ExistingAgent[],
    conductorReason: string
  ): Promise<HrChatResponse> {
    const agentSection = existingAgents.length > 0
      ? existingAgents.map(a =>
          `### ${a.specialistId}\n**Junior 역할:**\n${a.juniorPrompt.slice(0, 300)}...`
        ).join('\n\n')
      : '없음';

    const systemPrompt =
      this.systemPrompt +
      `\n\n## Conductor 전달 사유\n${conductorReason}` +
      `\n\n## 현재 등록된 에이전트\n${agentSection}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(h => ({
        role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const raw = await callLocalLlm(messages, this.config);
    return this.parseChatResponse(raw);
  }

  applyResult(result: HrChatResponse & { type: 'done' }): { specialistId: string; displayName: string } {
    const agentId = result.agentId;
    const dir = path.join(this.agentsDir, agentId);
    fs.mkdirSync(dir, { recursive: true });
    if (result.juniorPrompt) {
      fs.writeFileSync(path.join(dir, 'junior.md'), result.juniorPrompt, 'utf-8');
    }
    if (result.seniorPrompt) {
      fs.writeFileSync(path.join(dir, 'senior.md'), result.seniorPrompt, 'utf-8');
    }
    return { specialistId: agentId, displayName: result.displayName };
  }

  readExistingAgents(): ExistingAgent[] {
    if (!fs.existsSync(this.agentsDir)) return [];
    const excluded = new Set(['conductor', 'hr', 'compiler']);
    return fs.readdirSync(this.agentsDir, { withFileTypes: true })
      .filter(e =>
        e.isDirectory() &&
        !excluded.has(e.name) &&
        fs.existsSync(path.join(this.agentsDir, e.name, 'junior.md'))
      )
      .map(e => ({
        specialistId: e.name,
        juniorPrompt: fs.readFileSync(path.join(this.agentsDir, e.name, 'junior.md'), 'utf-8'),
        seniorPrompt: fs.existsSync(path.join(this.agentsDir, e.name, 'senior.md'))
          ? fs.readFileSync(path.join(this.agentsDir, e.name, 'senior.md'), 'utf-8')
          : '',
      }));
  }

  private parseChatResponse(raw: string): HrChatResponse {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { type: 'message', content: raw.trim() };
    }
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.type === 'done' && parsed.agentId) {
        return {
          type: 'done',
          agentId: parsed.agentId,
          displayName: parsed.displayName ?? parsed.agentId,
          summary: parsed.summary ?? '',
          juniorPrompt: parsed.juniorPrompt ?? '',
          seniorPrompt: parsed.seniorPrompt ?? '',
        };
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

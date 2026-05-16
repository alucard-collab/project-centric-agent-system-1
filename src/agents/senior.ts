import * as fs from 'fs';
import * as path from 'path';
import { PcasConfig } from '../types';
import { getModelForAgent } from '../config';
import { callLocalLlm } from '../llm';

export interface ReviewResult {
  approved: boolean;
  feedback: string;
  summary: string;
}

const FALLBACK_PROMPT = `당신은 Senior 에이전트입니다. 주니어 결과물을 검토하세요.
반드시 JSON으로만 출력: {"approved": true/false, "feedback": "...", "summary": "..."}`;

export class SeniorAgent {
  private systemPrompt: string;

  constructor(private config: PcasConfig, agentsDir: string, specialistId: string) {
    const promptPath = path.join(agentsDir, specialistId, 'senior.md');
    this.systemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : FALLBACK_PROMPT;
  }

  async review(task: string, juniorOutput: string, context: string): Promise<ReviewResult> {
    const userMessage = `## 검토 요청\n${task}\n\n## 주니어 결과물\n${juniorOutput}${
      context.trim() ? `\n\n## 컨텍스트\n${context}` : ''
    }`;

    const modelTarget = getModelForAgent('senior', this.config);
    if (modelTarget === 'cloud') {
      throw new Error('Senior 클라우드 모델 미구현 (Phase 5)');
    }

    const raw = await callLocalLlm(
      [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
      this.config
    );
    return this.parseReview(raw);
  }

  private parseReview(raw: string): ReviewResult {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as ReviewResult;
        return {
          approved: Boolean(parsed.approved),
          feedback: parsed.feedback ?? '',
          summary:  parsed.summary ?? '',
        };
      } catch { /* fall through */ }
    }
    const approved = /approve|승인|lgtm/i.test(raw);
    return { approved, feedback: approved ? '' : raw, summary: approved ? raw.slice(0, 100) : '' };
  }
}

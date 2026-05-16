import * as fs from 'fs';
import * as path from 'path';
import { PcasConfig, TaskPlan } from '../types';
import { callLocalLlm } from '../llm';

export interface HrAdequateResult {
  action: 'adequate';
  reason: string;
}

export interface HrCreateResult {
  action: 'create';
  specialistId: string;
  displayName: string;
  reason: string;
  juniorPrompt: string;
  seniorPrompt: string;
}

export interface HrExpandResult {
  action: 'expand';
  targetSpecialistId: string;
  displayName: string;
  reason: string;
  updatedJuniorPrompt: string;
  updatedSeniorPrompt: string;
}

export type HrResult = HrAdequateResult | HrCreateResult | HrExpandResult;

export interface ExistingAgent {
  specialistId: string;
  juniorPrompt: string;
  seniorPrompt: string;
}

const FALLBACK_PROMPT = `당신은 HR 에이전트입니다. 필요한 전문 에이전트를 설계하세요.
반드시 JSON으로만 출력하세요.`;

export class HrAgent {
  private systemPrompt: string;

  constructor(private config: PcasConfig, private agentsDir: string) {
    const promptPath = path.join(agentsDir, 'hr', 'hr.md');
    this.systemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : FALLBACK_PROMPT;
  }

  async reviewPlan(plan: TaskPlan, existingAgents: ExistingAgent[]): Promise<HrResult> {
    const agentSection = existingAgents.length > 0
      ? existingAgents.map(a =>
          `### ${a.specialistId}\n**Junior 역할:**\n${a.juniorPrompt.slice(0, 300)}...\n\n**Senior 역할:**\n${a.seniorPrompt.slice(0, 200)}...`
        ).join('\n\n')
      : '없음';

    const taskSection = plan.tasks.map((t, i) =>
      `${i + 1}. [${t.agent}] ${t.task}`
    ).join('\n');

    const userMessage =
      `## Conductor가 작성한 작업 계획\n**브리프:** ${plan.brief}\n\n**태스크 목록:**\n${taskSection}` +
      `\n\n## 현재 등록된 에이전트\n${agentSection}`;

    const raw = await callLocalLlm(
      [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
      this.config
    );
    return this.parseResult(raw);
  }

  async decide(roleDescription: string, existingAgents: ExistingAgent[]): Promise<HrResult> {
    const existingSection = existingAgents.length > 0
      ? `## 현재 등록된 에이전트\n${existingAgents.map(a =>
          `### ${a.specialistId}\n**Junior 역할:**\n${a.juniorPrompt.slice(0, 300)}...\n\n**Senior 역할:**\n${a.seniorPrompt.slice(0, 200)}...`
        ).join('\n\n')}`
      : '## 현재 등록된 에이전트\n없음';

    const userMessage = `## 요청된 역할\n${roleDescription}\n\n${existingSection}`;

    const raw = await callLocalLlm(
      [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
      this.config
    );
    return this.parseResult(raw);
  }

  applyResult(result: HrResult): { specialistId: string; displayName: string } | null {
    if (result.action === 'adequate') {
      return null;
    }
    if (result.action === 'create') {
      const dir = path.join(this.agentsDir, result.specialistId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'junior.md'), result.juniorPrompt, 'utf-8');
      fs.writeFileSync(path.join(dir, 'senior.md'), result.seniorPrompt, 'utf-8');
      return { specialistId: result.specialistId, displayName: result.displayName };
    } else {
      const dir = path.join(this.agentsDir, result.targetSpecialistId);
      fs.writeFileSync(path.join(dir, 'junior.md'), result.updatedJuniorPrompt, 'utf-8');
      fs.writeFileSync(path.join(dir, 'senior.md'), result.updatedSeniorPrompt, 'utf-8');
      return { specialistId: result.targetSpecialistId, displayName: result.displayName };
    }
  }

  private parseResult(raw: string): HrResult {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`HR 에이전트가 JSON이 아닌 응답을 반환했습니다:\n${raw}`);
    }
    const parsed = JSON.parse(match[0]) as HrResult;
    if (parsed.action !== 'adequate' && parsed.action !== 'create' && parsed.action !== 'expand') {
      throw new Error(`HR 에이전트의 action 값이 올바르지 않습니다: ${(parsed as { action: string }).action}`);
    }
    return parsed;
  }
}

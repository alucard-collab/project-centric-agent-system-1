import { TaskPlan, Channel } from '../types';
import { AgentBridge } from '../bridge';
import { JuniorAgent } from '../agents/junior';
import { SeniorAgent } from '../agents/senior';
import { Storage } from '../storage';
import { PcasConfig } from '../types';

const MAX_RETRIES = 3;

export interface LoopResult {
  channelId: string;
  status: 'completed' | 'escalated';
  finalOutput: string;
  escalationReason?: string;
}

export interface LoopProgress {
  stage: 'junior' | 'senior' | 'revision' | 'escalation';
  attempt: number;
  message: string;
}

export class ChannelLoop {
  constructor(
    private config: PcasConfig,
    private agentsDir: string,
    private storage: Storage,
    private channel: Channel,
    private onProgress?: (p: LoopProgress) => void,
    private onLog?: (role: string, content: string) => void
  ) {}

  async run(plan: TaskPlan): Promise<LoopResult> {
    const context = this.storage.readSharedMemory();
    let finalOutput = '';
    const totalTasks = plan.tasks.length;

    this.storage.writeStatus({
      channelId: this.channel.id,
      channelName: this.channel.name,
      currentTask: 0,
      totalTasks,
      stage: 'junior',
      agent: '',
      attempt: 0,
      summary: '작업 시작',
    });

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      const specialistId = task.agent;
      const junior = new JuniorAgent(this.config, this.agentsDir, specialistId);
      const senior = new SeniorAgent(this.config, this.agentsDir, specialistId);
      const bridge = new AgentBridge(junior, senior);

      this.storage.writeStatus({
        currentTask: i + 1,
        agent: specialistId,
        stage: 'junior',
        attempt: 1,
        summary: `[${specialistId}] 태스크 ${i + 1}/${totalTasks} 시작`,
      });

      const result = await this.runSpecialistLoop(task.task, specialistId, bridge, context);

      finalOutput = result.output;
      if (result.escalated) {
        this.storage.writeStatus({ stage: 'escalation', summary: result.escalationReason ?? '' });
        return {
          channelId: this.channel.id,
          status: 'escalated',
          finalOutput,
          escalationReason: result.escalationReason,
        };
      }
    }

    this.storage.writeStatus({ stage: 'completed', summary: '모든 태스크 완료' });
    return { channelId: this.channel.id, status: 'completed', finalOutput };
  }

  private async runSpecialistLoop(
    task: string,
    specialistId: string,
    bridge: AgentBridge,
    context: string
  ): Promise<{ output: string; escalated: boolean; escalationReason?: string }> {

    this.emit({ stage: 'junior', attempt: 1, message: `[${specialistId}] Junior 작업 중...` });

    let juniorOutput = await bridge.route({
      header: { channelId: this.channel.id, from: 'conductor', to: 'junior' },
      payload: { task, context, artifacts: [] },
    });

    this.log(`${specialistId}_junior`, 'junior', juniorOutput);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      this.emit({ stage: 'senior', attempt, message: `[${specialistId}] Senior 검토 중 (${attempt}/${MAX_RETRIES})` });
      this.storage.writeStatus({
        stage: 'senior',
        attempt,
        summary: `[${specialistId}] Senior 검토 ${attempt}/${MAX_RETRIES}`,
      });

      const reviewRaw = await bridge.route({
        header: { channelId: this.channel.id, from: 'conductor', to: 'senior' },
        payload: { task, context, artifacts: [juniorOutput] },
      });

      let review = { approved: false, feedback: reviewRaw, summary: '' };
      try { review = JSON.parse(reviewRaw); } catch { /* fallback */ }

      this.log(`${specialistId}_senior`, 'senior', reviewRaw);

      if (review.approved) {
        this.storage.writeOutput(
          `${specialistId}-output-${Date.now()}.md`,
          `# [${specialistId}] 최종 산출물\n\n${juniorOutput}\n\n---\n*Senior 승인: ${review.summary}*`
        );
        this.storage.writeStatus({
          stage: 'completed',
          summary: `[${specialistId}] 완료 — ${review.summary}`,
        });
        return { output: juniorOutput, escalated: false };
      }

      if (attempt >= MAX_RETRIES) break;

      this.emit({ stage: 'revision', attempt, message: `[${specialistId}] Junior 재작업 (${attempt}회차)` });
      this.storage.writeStatus({
        stage: 'revision',
        attempt,
        summary: `[${specialistId}] Junior 재작업 ${attempt}회차`,
      });

      juniorOutput = await bridge.route({
        header: { channelId: this.channel.id, from: 'senior', to: 'junior', returnAddress: 'senior' },
        payload: { task, context, artifacts: [juniorOutput, review.feedback] },
      });

      this.log(`${specialistId}_junior`, 'junior', `[재작업 ${attempt}회차]\n${juniorOutput}`);
    }

    const reason = `[${specialistId}] ${MAX_RETRIES}회 반복 후 Senior 미승인. 태스크 재검토 필요.`;
    this.emit({ stage: 'escalation', attempt: MAX_RETRIES, message: reason });
    this.log('system', 'system', `[ESCALATION] ${reason}`);

    return { output: juniorOutput, escalated: true, escalationReason: reason };
  }

  private log(from: string, role: 'conductor' | 'junior' | 'senior' | 'system', content: string) {
    this.storage.appendLog({ timestamp: new Date().toISOString(), from, role, content });
    this.onLog?.(role, content);
  }

  private emit(progress: LoopProgress) {
    this.onProgress?.(progress);
  }
}

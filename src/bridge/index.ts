import { BridgeMessage } from '../types';
import { JuniorAgent } from '../agents/junior';
import { SeniorAgent } from '../agents/senior';

export class AgentBridge {
  constructor(
    private junior: JuniorAgent,
    private senior: SeniorAgent
  ) {}

  async route(message: BridgeMessage): Promise<string> {
    const { to, from } = message.header;
    const { task, context, artifacts } = message.payload;

    if (to === 'junior') {
      if (from === 'senior') {
        // 수정 요청: artifacts[0] = 이전 출력, artifacts[1] = 피드백
        const [previousOutput = '', feedback = ''] = artifacts;
        return this.junior.revise(task, previousOutput, feedback, context);
      }
      const ctx = artifacts.filter(Boolean).join('\n\n');
      return this.junior.execute(task, ctx || context);
    }

    if (to === 'senior') {
      // artifacts[0] = 주니어 결과물
      const [juniorOutput = ''] = artifacts;
      const result = await this.senior.review(task, juniorOutput, context);
      return JSON.stringify(result);
    }

    throw new Error(`알 수 없는 에이전트 대상: "${to}"`);
  }
}

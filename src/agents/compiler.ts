import * as fs from 'fs';
import * as path from 'path';
import { PcasConfig } from '../types';
import { getModelForAgent } from '../config';
import { callLocalLlm, detectLocalModel, ChatMessage } from '../llm';

export interface CompileInput {
  channelName: string;
  channelId: string;
  brief: string;
  logsContent: string;
  conversationContent: string;
  existingWikiIndex: string;
}

export interface CompileOutput {
  projectPage: string;
  wikiLogEntry: string;
}

export class CompilerAgent {
  private systemPrompt: string;

  constructor(private config: PcasConfig, private agentsDir: string) {
    const promptPath = path.join(agentsDir, 'compiler', 'compiler.md');
    this.systemPrompt = fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, 'utf-8')
      : DEFAULT_PROMPT;
  }

  async compile(input: CompileInput): Promise<CompileOutput> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user',   content: buildUserMessage(input) },
    ];

    const modelTarget = getModelForAgent('compiler', this.config);
    if (modelTarget === 'cloud') {
      throw new Error('클라우드 모델 미구현.');
    }

    const model = this.config.localModelName || await detectLocalModel(this.config);
    const raw = await callLocalLlm(messages, this.config, model);
    return parseResponse(raw, input.channelName, input.brief);
  }
}

function buildUserMessage(input: CompileInput): string {
  return [
    `## 채널 정보`,
    `- 채널명: ${input.channelName}`,
    `- 브리프: ${input.brief}`,
    ``,
    `## 작업 로그`,
    '```json',
    input.logsContent.slice(0, 4000),
    '```',
    ``,
    `## Conductor 대화`,
    input.conversationContent.slice(0, 2000),
    ``,
    `## 기존 Wiki Index`,
    input.existingWikiIndex.slice(0, 1000),
  ].join('\n');
}

function parseResponse(raw: string, channelName: string, brief: string): CompileOutput {
  const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/\{[\s\S]*\}/);
  const jsonStr   = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : null;

  if (jsonStr) {
    try {
      const p = JSON.parse(jsonStr);
      if (p.projectPage && p.wikiLogEntry) {
        return { projectPage: p.projectPage, wikiLogEntry: p.wikiLogEntry };
      }
    } catch { /* fall through */ }
  }

  const date = new Date().toISOString().slice(0, 10);
  return {
    projectPage:  `# ${channelName}\n\n**브리프**: ${brief}\n\n## 결과\n\n${raw.trim()}`,
    wikiLogEntry: `## [${date}] ingest | ${channelName}\n- 브리프: ${brief}\n- 자동 컴파일 완료`,
  };
}

const DEFAULT_PROMPT = `You are a Knowledge Compiler for the PCAS multi-agent system.
Read task execution data and compile reusable knowledge into wiki pages.

Output valid JSON only (no markdown code fences):
{"projectPage":"# ChannelName\\n\\n**브리프**: ...\\n\\n## 결과\\n\\n...\\n\\n## 주요 결정\\n\\n...\\n\\n## 인사이트\\n\\n...","wikiLogEntry":"## [YYYY-MM-DD] ingest | ChannelName\\n- 브리프: ...\\n- 재사용 인사이트: ..."}

Rules:
- projectPage: markdown with 결과, 주요 결정, 인사이트 sections.
- wikiLogEntry: ## [YYYY-MM-DD] ingest | channelName format.
- Focus on REUSABLE patterns, decisions, lessons — not one-off task details.
- Write all content in Korean.`;

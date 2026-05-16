import * as fs from 'fs';
import * as path from 'path';
import { ConversationMessage } from './types';

export class KnowledgeDB {
  readonly rawConvDir: string;
  readonly rawOutputsDir: string;
  readonly wikiDir: string;

  constructor(private knowledgeDir: string) {
    this.rawConvDir    = path.join(knowledgeDir, '00_Raw', 'conversations');
    this.rawOutputsDir = path.join(knowledgeDir, '00_Raw', 'outputs');
    this.wikiDir       = path.join(knowledgeDir, '10_Wiki');
  }

  initDirs(): void {
    for (const dir of [
      this.rawConvDir,
      this.rawOutputsDir,
      this.wikiDir,
      path.join(this.wikiDir, 'projects'),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const indexPath = path.join(this.wikiDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        '# Knowledge Wiki Index\n\n' +
        '*PCAS가 작업을 완료할 때마다 여기에 지식이 자동으로 누적됩니다.*\n\n' +
        '## Projects\n\n'
      );
    }

    const logPath = path.join(this.wikiDir, 'log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '# Knowledge Wiki Log\n\n');
    }
  }

  saveConversation(history: ConversationMessage[], channelName = ''): string {
    fs.mkdirSync(this.rawConvDir, { recursive: true });
    const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix   = channelName ? `-${slugify(channelName)}` : '';
    const filepath = path.join(this.rawConvDir, `${stamp}${suffix}.md`);

    const lines: string[] = [`# Conversation — ${new Date().toLocaleString('ko-KR')}`];
    if (channelName) { lines.push(`**채널**: ${channelName}`); }
    lines.push('');

    for (const msg of history) {
      lines.push(msg.role === 'user' ? '## User' : '## Conductor');
      lines.push(msg.content, '');
    }

    fs.writeFileSync(filepath, lines.join('\n'));
    return filepath;
  }

  saveChannelOutput(channelDir: string, channelId: string): void {
    const destDir = path.join(this.rawOutputsDir, channelId);
    copyDirRecursive(channelDir, destDir);
  }

  readWikiContext(): string {
    const parts: string[] = [];

    const indexPath = path.join(this.wikiDir, 'index.md');
    if (fs.existsSync(indexPath)) {
      parts.push(fs.readFileSync(indexPath, 'utf-8').slice(0, 3000));
    } else {
      // Fallback: legacy root-level index.md
      const legacy = path.join(this.knowledgeDir, 'index.md');
      if (fs.existsSync(legacy)) {
        parts.push(fs.readFileSync(legacy, 'utf-8').slice(0, 2000));
      }
    }

    const logPath = path.join(this.wikiDir, 'log.md');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      parts.push(content.slice(-2000));
    }

    return parts.join('\n\n---\n\n').trim();
  }

  readExistingWikiIndex(): string {
    const p = path.join(this.wikiDir, 'index.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').slice(0, 2000) : '';
  }

  writeProjectPage(channelName: string, content: string): void {
    const dir = path.join(this.wikiDir, 'projects', slugify(channelName));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.md'), content);
  }

  appendWikiLog(entry: string): void {
    fs.appendFileSync(path.join(this.wikiDir, 'log.md'), `\n${entry}\n`);
  }

  updateWikiIndex(channelName: string, brief: string): void {
    const line = `- [[projects/${slugify(channelName)}/index|${channelName}]] — ${brief}\n`;
    fs.appendFileSync(path.join(this.wikiDir, 'index.md'), line);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) { return; }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      try { fs.copyFileSync(s, d); } catch { /* ignore */ }
    }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'channel';
}

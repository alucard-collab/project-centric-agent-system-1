import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { LogEntry, ChannelLogs, ChannelStatus } from '../types';

export class Storage {
  constructor(private channelDir: string) {}

  readSharedMemory(): string {
    const p = path.join(this.channelDir, 'shared_memory.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }

  appendSharedMemory(content: string): void {
    fs.appendFileSync(path.join(this.channelDir, 'shared_memory.md'), `\n${content}`);
  }

  readLogs(): ChannelLogs {
    const p = path.join(this.channelDir, 'logs.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ChannelLogs;
  }

  appendLog(entry: LogEntry): void {
    const logs = this.readLogs();
    logs.logs.push(entry);
    fs.writeFileSync(path.join(this.channelDir, 'logs.json'), JSON.stringify(logs, null, 2));
  }

  writeOutput(filename: string, content: string): void {
    const outputsDir = path.join(this.channelDir, 'outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    fs.writeFileSync(path.join(outputsDir, filename), content);
  }

  readStatus(): ChannelStatus | null {
    const p = path.join(this.channelDir, 'status.json');
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as ChannelStatus;
    } catch {
      return null;
    }
  }

  writeStatus(partial: Partial<ChannelStatus>): void {
    const existing = this.readStatus() ?? ({} as Partial<ChannelStatus>);
    const updated = { ...existing, ...partial, lastUpdate: new Date().toISOString() };
    fs.writeFileSync(path.join(this.channelDir, 'status.json'), JSON.stringify(updated, null, 2));
  }

  gitSync(workspaceRoot: string): void {
    const run = (args: string[]) =>
      spawnSync('git', args, { cwd: workspaceRoot, encoding: 'utf-8', timeout: 15000 });

    const status = run(['status', '--porcelain', '.pcas']);
    if (status.error || status.status !== 0) return;
    if (!status.stdout?.trim()) return;

    run(['add', '.pcas']);
    run(['commit', '-m', `pcas: sync ${path.basename(this.channelDir)}`]);

    const hasRemote = run(['remote', 'get-url', 'origin']);
    if (hasRemote.status === 0) {
      run(['push', 'origin', 'HEAD']);
    }
  }
}

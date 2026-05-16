import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Channel, ChannelLogs } from '../types';

export class SessionManager {
  private sessionsDir: string;

  constructor(workspaceRoot: string) {
    this.sessionsDir = path.join(workspaceRoot, '.pcas', 'sessions');
  }

  ensureSessionsDir(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  createChannel(name: string): Channel {
    const id = this.generateChannelId();
    const channelDir = path.join(this.sessionsDir, id);

    fs.mkdirSync(path.join(channelDir, 'outputs'), { recursive: true });

    const channel: Channel = {
      id,
      name,
      createdAt: new Date().toISOString(),
      dir: channelDir,
    };

    const initialLogs: ChannelLogs = { channelId: id, name, logs: [] };

    fs.writeFileSync(
      path.join(channelDir, 'shared_memory.md'),
      `# Channel: ${name}\n\nCreated: ${channel.createdAt}\n`
    );
    fs.writeFileSync(
      path.join(channelDir, 'logs.json'),
      JSON.stringify(initialLogs, null, 2)
    );
    fs.writeFileSync(
      path.join(channelDir, 'meta.json'),
      JSON.stringify(channel, null, 2)
    );

    return channel;
  }

  listChannels(): Channel[] {
    this.ensureSessionsDir();
    const entries = fs.readdirSync(this.sessionsDir, { withFileTypes: true });
    const channels: Channel[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(this.sessionsDir, entry.name, 'meta.json');
      if (fs.existsSync(metaPath)) {
        channels.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Channel);
      }
    }

    return channels.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getChannel(id: string): Channel | null {
    const metaPath = path.join(this.sessionsDir, id, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Channel;
  }

  private generateChannelId(): string {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(3).toString('hex');
    return `${ts}-${rand}`;
  }
}

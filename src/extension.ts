import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SessionManager } from './session';
import { ConductorAgent } from './conductor';
import { ChannelLoop } from './loop';
import { Storage } from './storage';
import { KnowledgeDB } from './knowledge';
import { getConfig, getAgentsDir } from './config';
import { HrAgent } from './agents/hr';
import { CompilerAgent } from './agents/compiler';
import { listLocalModels } from './llm';
import { SidebarProvider } from './webview/SidebarProvider';
import { PcasPanel } from './webview/panel';
import { ConversationMessage, TaskPlan } from './types';

let conductorHistory: ConversationMessage[] = [];
let hrHistory: ConversationMessage[] = [];
let hrMode = false;
let hrConductorReason = '';
let _sessionManager: SessionManager | undefined;
let _extensionContext: vscode.ExtensionContext | undefined;
let _knowledgeDb: KnowledgeDB | undefined;

export function activate(context: vscode.ExtensionContext) {
  _extensionContext = context;
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath;

  const config = getConfig();
  const agentsDir = getAgentsDir(config.knowledgeDir);

  _knowledgeDb = new KnowledgeDB(config.knowledgeDir);
  try {
    _knowledgeDb.initDirs();
  } catch (e) {
    console.error('PCAS: knowledgeDb.initDirs failed:', e);
  }

  try {
    syncBuiltinAgents(context.extensionPath, agentsDir);
  } catch (e) {
    console.error('PCAS: syncBuiltinAgents failed:', e);
  }

  _sessionManager = new SessionManager(workspaceRoot);
  try {
    _sessionManager.ensureSessionsDir();
  } catch (e) {
    console.error('PCAS: ensureSessionsDir failed:', e);
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      new SidebarProvider(
        context.extensionPath,
        msg => handleSidebarMessage(msg, context)
      )
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pcas.openPanel', () => {
      openMainPanel(context);
    }),
    vscode.commands.registerCommand('pcas.newChannel', () =>
      vscode.commands.executeCommand('pcas.openPanel')
    ),
    vscode.commands.registerCommand('pcas.listChannels', () =>
      vscode.commands.executeCommand('pcas.openPanel')
    )
  );

  openMainPanel(context);
}

function openMainPanel(context: vscode.ExtensionContext) {
  // Re-sync system agents every time panel opens — guarantees correct knowledgeDir is used
  // (activate() may run before VS Code loads workspace settings)
  const config = getConfig();
  try {
    syncBuiltinAgents(context.extensionPath, getAgentsDir(config.knowledgeDir));
  } catch (e) {
    console.error('PCAS: syncBuiltinAgents (panel open) failed:', e);
  }

  PcasPanel.createOrShow(
    context.extensionPath,
    msg => handleMessage(msg, context, _sessionManager!)
  );
}

export function deactivate() {
  if (_knowledgeDb && conductorHistory.length > 0) {
    try {
      _knowledgeDb.saveConversation(conductorHistory, 'session-end');
    } catch (e) {
      console.error('PCAS: deactivate saveConversation failed:', e);
    }
  }
}

function post(message: object) {
  PcasPanel.currentPanel?.post(message);
}

function postSidebar(message: object) {
  SidebarProvider.post(message);
}

// ── Message dispatcher ────────────────────────────────────────────
async function handleMessage(
  msg: Record<string, unknown>,
  context: vscode.ExtensionContext,
  sessionManager: SessionManager
) {
  switch (msg.command as string) {

    case 'ready': {
      post({
        type: 'init',
        channels: sessionManager.listChannels(),
      });
      break;
    }

    case 'conductorChat': {
      const { message } = msg as { message: string };
      if (hrMode) {
        await handleHrChat(message, context);
      } else {
        await handleConductorChat(message, context, sessionManager);
      }
      break;
    }

    case 'selectChannel': {
      const { channelId } = msg as { channelId: string };
      const channel = sessionManager.getChannel(channelId);
      if (!channel) break;
      const storage = new Storage(channel.dir);
      post({ type: 'channelData', channelId, logs: storage.readLogs().logs });
      break;
    }

    case 'refreshChannels': {
      post({ type: 'channels', channels: sessionManager.listChannels() });
      break;
    }
  }
}

// ── Sidebar message handler ──────────────────────────────────────
async function handleSidebarMessage(
  msg: Record<string, unknown>,
  context: vscode.ExtensionContext
) {
  switch (msg.command as string) {

    case 'sidebarReady': {
      const config = getConfig();
      postSidebar({
        type: 'init',
        settings: {
          apiType: config.apiType,
          model: config.localModelName,
          knowledgeDir: config.knowledgeDir,
        },
      });
      break;
    }

    case 'getModels': {
      const { apiType, url, currentModel } = msg as {
        apiType: 'ollama' | 'openai'; url: string; currentModel?: string;
      };
      try {
        const models = await listLocalModels(url, apiType);
        postSidebar({ type: 'models', models, currentModel });
        postSidebar({ type: 'status', status: 'online', text: models[0] ?? '' });
        post({ type: 'status', status: 'online', text: models[0] ?? '' });
      } catch {
        postSidebar({ type: 'models', models: [] });
        postSidebar({ type: 'status', status: 'offline', text: '연결 실패' });
        post({ type: 'status', status: 'offline', text: '연결 실패' });
      }
      break;
    }

    case 'setEngine': {
      const { apiType, url, model } = msg as {
        apiType: 'ollama' | 'openai'; url: string; model: string;
      };
      const cfg = vscode.workspace.getConfiguration('pcas');
      await cfg.update('localUrl',       url,     vscode.ConfigurationTarget.Global);
      await cfg.update('apiType',        apiType, vscode.ConfigurationTarget.Global);
      await cfg.update('localModelName', model,   vscode.ConfigurationTarget.Global);
      postSidebar({ type: 'status', status: 'online', text: model });
      post({ type: 'status', status: 'online', text: model });
      break;
    }

    case 'setKnowledgeDir': {
      const { dir } = msg as { dir: string };
      const oldDir = getConfig().knowledgeDir;
      const cfg = vscode.workspace.getConfiguration('pcas');
      await cfg.update('knowledgeDir', dir, vscode.ConfigurationTarget.Global);
      await migrateKnowledgeDir(oldDir, dir, context.extensionPath);
      _knowledgeDb = new KnowledgeDB(dir);
      try { _knowledgeDb.initDirs(); } catch { /* ignore */ }
      break;
    }

    case 'browseKnowledgeDir': {
      const result = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: '지식 DB 디렉토리 선택',
      });
      if (result?.[0]) {
        const dir = result[0].fsPath;
        const oldDir = getConfig().knowledgeDir;
        const cfg = vscode.workspace.getConfiguration('pcas');
        await cfg.update('knowledgeDir', dir, vscode.ConfigurationTarget.Global);
        await migrateKnowledgeDir(oldDir, dir, context.extensionPath);
        _knowledgeDb = new KnowledgeDB(dir);
        try { _knowledgeDb.initDirs(); } catch { /* ignore */ }
        postSidebar({ type: 'knowledgeDir', dir });
      }
      break;
    }

    case 'openPanel': {
      try {
        if (_extensionContext) openMainPanel(_extensionContext);
      } catch (e) {
        console.error('PCAS: openMainPanel failed:', e);
        postSidebar({ type: 'status', status: 'offline', text: '패널 열기 실패' });
      }
      break;
    }
  }
}

// ── Conductor multi-turn chat ────────────────────────────────────
async function handleConductorChat(
  message: string,
  context: vscode.ExtensionContext,
  sessionManager: SessionManager
) {
  const config = getConfig();
  const agentsDir = getAgentsDir(config.knowledgeDir);
  const conductor = new ConductorAgent(config, agentsDir);

  // Code-level guard: if no specialists registered, go straight to HR
  // (don't rely on LLM to follow the "empty list → hr" instruction)
  if (conductor.scanSpecialists().length === 0) {
    conductorHistory.push({ role: 'user', content: message });
    await startHrSession(
      '등록된 전문 에이전트가 없습니다. 업무를 수행할 에이전트 팀을 먼저 구성해야 합니다.',
      config,
      agentsDir
    );
    return;
  }

  const statusContext = buildStatusContext(sessionManager);
  post({ type: 'conductorTyping' });

  try {
    const response = await conductor.chat(message, conductorHistory, statusContext);

    if (response.type === 'message') {
      conductorHistory.push({ role: 'user', content: message });
      conductorHistory.push({ role: 'assistant', content: response.content });
      post({ type: 'conductorReply', content: response.content });

    } else if (response.type === 'hr') {
      conductorHistory.push({ role: 'user', content: message });
      conductorHistory.push({ role: 'assistant', content: `[HR 담당자에게 전달: ${response.reason}]` });
      await startHrSession(response.reason, config, agentsDir);

    } else {
      // plan
      const replyContent =
        `알겠습니다! **#${response.plan.channelName}** 채널을 생성하겠습니다.\n\n${response.summary}`;
      conductorHistory.push({ role: 'user', content: message });
      conductorHistory.push({ role: 'assistant', content: replyContent });
      post({ type: 'conductorReply', content: replyContent, planChannelName: response.plan.channelName });

      // Save conversation snapshot to 00_Raw before launching task
      let convSnapshot = '';
      if (_knowledgeDb) {
        try {
          const convPath = _knowledgeDb.saveConversation(conductorHistory, response.plan.channelName);
          convSnapshot = fs.readFileSync(convPath, 'utf-8');
        } catch (e) {
          console.error('PCAS: saveConversation failed:', e);
        }
      }

      runTaskChannel(response.plan, context, sessionManager, convSnapshot).catch(err => {
        post({ type: 'conductorReply', content: `채널 실행 오류: ${err instanceof Error ? err.message : String(err)}` });
      });
    }
  } catch (err) {
    post({
      type: 'conductorReply',
      content: `오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    });
  }
}

function buildStatusContext(sessionManager: SessionManager): string {
  const channels = sessionManager.listChannels();
  if (channels.length === 0) return '';

  const lines: string[] = [];
  for (const ch of channels) {
    const status = new Storage(ch.dir).readStatus();
    if (status) {
      lines.push(`- **#${ch.name}**: ${status.stage} — ${status.summary} (태스크 ${status.currentTask}/${status.totalTasks})`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\n## 현재 작업 채널 상태\n${lines.join('\n')}`;
}

// ── Task channel runner ───────────────────────────────────────────
async function runTaskChannel(
  plan: TaskPlan,
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  convSnapshot = ''
) {
  const config = getConfig();
  const agentsDir = getAgentsDir(config.knowledgeDir);

  // Validate all agents in the plan exist before starting
  const missingAgents = plan.tasks
    .map(t => t.agent)
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .filter(id => !fs.existsSync(path.join(agentsDir, id, 'junior.md')));

  if (missingAgents.length > 0) {
    post({
      type: 'conductorReply',
      content: `작업을 시작할 수 없습니다. 다음 에이전트가 존재하지 않습니다: **${missingAgents.join(', ')}**\n\nHR 담당자에게 에이전트 생성을 요청하거나, 업무를 다시 지시해 주세요.`,
      isError: true,
    });
    return;
  }

  const channel = sessionManager.createChannel(plan.channelName ?? slugify(plan.brief));
  const storage = new Storage(channel.dir);

  // Inject accumulated wiki knowledge as context (replaces readKnowledgeContext)
  if (_knowledgeDb) {
    const wikiCtx = _knowledgeDb.readWikiContext();
    if (wikiCtx) { storage.appendSharedMemory(`## 지식 컨텍스트\n${wikiCtx}`); }
  }

  storage.appendLog({
    timestamp: new Date().toISOString(),
    from: 'conductor',
    role: 'conductor',
    content: `브리프: ${plan.brief}\n태스크: ${plan.tasks.map(t => `[${t.agent}] ${t.task}`).join(' / ')}`,
  });
  storage.appendSharedMemory(
    `## 작업 브리프\n${plan.brief}\n\n## 태스크 목록\n${plan.tasks
      .map((t, i) => `${i + 1}. [${t.agent}] ${t.task}`)
      .join('\n')}`
  );

  post({ type: 'taskChannelCreated', channel });
  post({ type: 'taskProgress', channelId: channel.id, role: 'conductor', content: `브리프: ${plan.brief}` });

  const loop = new ChannelLoop(
    config,
    getAgentsDir(config.knowledgeDir),
    storage,
    channel,
    ({ message }) => post({ type: 'taskProgress', channelId: channel.id, role: 'system', content: message }),
    (role, content) => post({ type: 'taskProgress', channelId: channel.id, role, content })
  );

  const result = await loop.run(plan);

  // Persist raw channel data to knowledgeDir/00_Raw
  if (_knowledgeDb) {
    try { _knowledgeDb.saveChannelOutput(channel.dir, channel.id); } catch (e) {
      console.error('PCAS: saveChannelOutput failed:', e);
    }
  }

  if (result.status === 'completed') {
    post({ type: 'taskComplete', channelId: channel.id, output: result.finalOutput });

    // Compile knowledge in background (fire and forget)
    if (_knowledgeDb) {
      const kb = _knowledgeDb;
      runCompiler(config, getAgentsDir(config.knowledgeDir), channel.id, channel.name, plan.brief, channel.dir, convSnapshot, kb)
        .catch(e => console.error('PCAS: compiler failed:', e));
    }
  } else {
    post({ type: 'taskEscalated', channelId: channel.id, reason: result.escalationReason ?? '' });
  }

  post({ type: 'channels', channels: sessionManager.listChannels() });
}

async function runCompiler(
  config: ReturnType<typeof getConfig>,
  agentsDir: string,
  channelId: string,
  channelName: string,
  brief: string,
  channelDir: string,
  convSnapshot: string,
  knowledgeDb: KnowledgeDB
) {
  post({ type: 'conductorReply', content: `📚 **#${channelName}** 결과를 Knowledge Wiki에 컴파일하는 중...` });

  const logsPath = path.join(channelDir, 'logs.json');
  const logsContent = fs.existsSync(logsPath) ? fs.readFileSync(logsPath, 'utf-8') : '';
  const existingWikiIndex = knowledgeDb.readExistingWikiIndex();

  const compiler = new CompilerAgent(config, agentsDir);
  const output = await compiler.compile({
    channelName, channelId, brief,
    logsContent,
    conversationContent: convSnapshot,
    existingWikiIndex,
  });

  knowledgeDb.writeProjectPage(channelName, output.projectPage);
  knowledgeDb.appendWikiLog(output.wikiLogEntry);
  knowledgeDb.updateWikiIndex(channelName, brief);

  post({ type: 'conductorReply', content: `✅ Knowledge Wiki 업데이트 완료: **${channelName}**` });
}

// ── HR session start (shared by code-level guard and Conductor hr response) ──
async function startHrSession(reason: string, config: ReturnType<typeof getConfig>, agentsDir: string) {
  hrMode = true;
  hrHistory = [];
  hrConductorReason = reason;

  const hr = new HrAgent(config, agentsDir);
  try {
    const greeting = await hr.chat(
      `Conductor로부터 다음 사유로 안내받았습니다: "${reason}"\n첫 인사와 함께 사용자에게 어떤 도움이 필요한지 물어봐 주세요.`,
      [],
      hr.readExistingAgents(),
      reason
    );
    const content = greeting.type === 'message' ? greeting.content : '';
    hrHistory.push({ role: 'assistant', content });
    post({ type: 'conductorReply', content: `**[HR 담당자]** ${content}`, isHr: true });
  } catch (err) {
    post({ type: 'conductorReply', content: `HR 시작 오류: ${err instanceof Error ? err.message : String(err)}`, isError: true });
  }
}

// ── HR multi-turn chat ────────────────────────────────────────────
async function handleHrChat(message: string, context: vscode.ExtensionContext) {
  const config = getConfig();
  const agentsDir = getAgentsDir(config.knowledgeDir);
  const hr = new HrAgent(config, agentsDir);

  post({ type: 'conductorTyping' });
  hrHistory.push({ role: 'user', content: message });

  try {
    const response = await hr.chat(message, hrHistory, hr.readExistingAgents(), hrConductorReason);

    if (response.type === 'message') {
      hrHistory.push({ role: 'assistant', content: response.content });
      post({ type: 'conductorReply', content: `**[HR 담당자]** ${response.content}`, isHr: true });

    } else {
      // done — apply result and exit HR mode
      hr.applyResult(response);
      hrMode = false;
      hrHistory = [];

      post({
        type: 'conductorReply',
        content: `**[HR 담당자]** ${response.summary}\n\n에이전트 **${response.displayName}** 준비 완료. 업무를 다시 지시해 주세요.`,
        isHr: true,
      });
    }
  } catch (err) {
    post({
      type: 'conductorReply',
      content: `HR 오류: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────
// System agents bundled with the extension (never user-created specialists)
const SYSTEM_AGENTS = new Set(['conductor', 'hr', 'compiler']);

function syncBuiltinAgents(extensionPath: string, agentsDir: string) {
  const builtinDir = path.join(extensionPath, 'agents');
  if (!fs.existsSync(builtinDir)) return;

  try { fs.mkdirSync(agentsDir, { recursive: true }); } catch { return; }

  for (const entry of fs.readdirSync(builtinDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SYSTEM_AGENTS.has(entry.name)) continue;
    const destDir = path.join(agentsDir, entry.name);
    try { fs.mkdirSync(destDir, { recursive: true }); } catch { continue; }
    for (const file of fs.readdirSync(path.join(builtinDir, entry.name))) {
      const dest = path.join(destDir, file);
      try {
        // System agents are always overwritten — user cannot modify them
        fs.copyFileSync(path.join(builtinDir, entry.name, file), dest);
      } catch { /* 개별 파일 복사 실패는 무시 */ }
    }
  }
}

async function migrateKnowledgeDir(oldDir: string, newDir: string, extensionPath: string) {
  if (oldDir === newDir) return;

  if (fs.existsSync(oldDir)) {
    const answer = await vscode.window.showInformationMessage(
      `기존 지식 데이터를 새 경로로 복사하시겠습니까?\n\n현재: ${oldDir}\n새 경로: ${newDir}`,
      { modal: true },
      '예 (전체 복사)',
      '아니오 (기본 에이전트만)',
    );
    if (answer === '예 (전체 복사)') {
      copyDirRecursive(oldDir, newDir);
    }
  }

  syncBuiltinAgents(extensionPath, getAgentsDir(newDir));
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'channel';
}

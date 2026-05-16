import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'pcas.sidebar';
  private static _view: vscode.WebviewView | undefined;

  constructor(
    private readonly _extensionPath: string,
    private readonly _onMessage: (msg: Record<string, unknown>) => void
  ) {}

  static post(message: object): void {
    SidebarProvider._view?.webview.postMessage(message);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    SidebarProvider._view = view;
    view.webview.options = { enableScripts: true };

    try {
      const htmlPath = path.join(this._extensionPath, 'media', 'sidebar.html');
      view.webview.html = fs.readFileSync(htmlPath, 'utf-8');
    } catch (e) {
      view.webview.html = `<body style="color:#ccc;padding:16px;font-family:sans-serif">
        <b>PCAS 사이드바 로드 오류</b><br><small>${String(e)}</small></body>`;
      return;
    }

    view.webview.onDidReceiveMessage(msg => {
      this._onMessage(msg as Record<string, unknown>);
    });

    view.onDidDispose(() => {
      SidebarProvider._view = undefined;
    });
  }
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PcasPanel {
  static currentPanel: PcasPanel | undefined;
  static readonly viewType = 'pcas.panel';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionPath: string,
    onMessage: (msg: Record<string, unknown>) => void
  ): PcasPanel {
    if (PcasPanel.currentPanel) {
      PcasPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return PcasPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      PcasPanel.viewType,
      'PCAS',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    PcasPanel.currentPanel = new PcasPanel(panel, extensionPath, onMessage);
    return PcasPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    private readonly onMessage: (msg: Record<string, unknown>) => void
  ) {
    this._panel = panel;

    const htmlPath = path.join(extensionPath, 'media', 'main.html');
    this._panel.webview.html = fs.readFileSync(htmlPath, 'utf-8');

    this._panel.webview.onDidReceiveMessage(
      msg => this.onMessage(msg as Record<string, unknown>),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  post(message: object): void {
    this._panel.webview.postMessage(message);
  }

  dispose(): void {
    PcasPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }
}

import { describe, it, expect, beforeEach, vi } from 'vitest';

// fs / os をモック
vi.mock('fs', () => ({
  default: {
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  },
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

import fs from 'fs';
const mockFs = vi.mocked(fs);

let Msg: typeof import('../../src/messages.js').Msg;
let PlainMsg: typeof import('../../src/messages.js').PlainMsg;
let GetBotName: typeof import('../../src/messages.js').GetBotName;
let GetMessageKeys: typeof import('../../src/messages.js').GetMessageKeys;

describe('messages', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // デフォルト: messages.json が存在しない → LoadMessageConfig はデフォルト値を返す
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const mod = await import('../../src/messages.js');
    Msg = mod.Msg;
    PlainMsg = mod.PlainMsg;
    GetBotName = mod.GetBotName;
    GetMessageKeys = mod.GetMessageKeys;
  });

  // ============================================================
  // Msg
  // ============================================================
  describe('Msg', () => {
    it('既知のキー → デフォルトメッセージ返却', () => {
      const result = Msg('console.startup');
      expect(result).toContain('起動いたしますわ');
    });

    it('未定義キー → キー文字列そのまま返却', () => {
      expect(Msg('unknown.key.xyz')).toBe('unknown.key.xyz');
    });

    it('変数置換 ({emoji}, {name}, {botName})', () => {
      const result = Msg('console.startup');
      // デフォルト: emoji=☕, name=クラリス
      expect(result).toContain('☕');
      expect(result).toContain('クラリス');
    });

    it('slackEmoji変数 → Slack絵文字(:coffee:等)が使われる', () => {
      // 'reflection.title' テンプレートは {slackEmoji} を含む
      const result = Msg('reflection.title', { date: '2026-02-16' });
      expect(result).toContain(':coffee:');
    });

    it('vars引数で追加変数を置換', () => {
      const result = Msg('task.started', { description: 'バグ修正タスク' });
      expect(result).toContain('バグ修正タスク');
    });
  });

  // ============================================================
  // PlainMsg
  // ============================================================
  describe('PlainMsg', () => {
    it('slackEmoji変数 → Unicode絵文字(☕等)が使われる（Msgとの差分が重要）', () => {
      // Msg では :coffee:, PlainMsg では ☕
      const slackResult = Msg('reflection.title', { date: '2026-02-16' });
      const plainResult = PlainMsg('reflection.title', { date: '2026-02-16' });
      expect(slackResult).toContain(':coffee:');
      expect(plainResult).toContain('☕');
      expect(plainResult).not.toContain(':coffee:');
    });

    it('それ以外はMsgと同じ動作', () => {
      const plain = PlainMsg('console.startup');
      expect(plain).toContain('クラリス');
      expect(plain).toContain('起動いたしますわ');
    });

    it('未定義キー → キー文字列そのまま返却', () => {
      expect(PlainMsg('nonexistent.key')).toBe('nonexistent.key');
    });
  });

  // ============================================================
  // GetBotName
  // ============================================================
  describe('GetBotName', () => {
    it('デフォルト名を返す', () => {
      expect(GetBotName()).toBe('claris');
    });
  });

  // ============================================================
  // GetMessageKeys
  // ============================================================
  describe('GetMessageKeys', () => {
    it('DEFAULT_MESSAGESの全キーを返す', () => {
      const keys = GetMessageKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('console.startup');
      expect(keys).toContain('task.started');
      expect(keys).toContain('task.completed');
      expect(keys).toContain('reflection.title');
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { TaskSource, UserMapping } from '../../src/types/index.js';

// fs / os をモック
vi.mock('fs');
vi.mock('os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

// fs モックのセットアップ（existsSync=false でファイルなし）
import fs from 'fs';
const mockFs = vi.mocked(fs);

// シングルトンをリセットするため、動的インポートを使う
let GetSessionStore: typeof import('../../src/session/store.js').GetSessionStore;

describe('SessionStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // ファイル存在チェック: デフォルトではファイルなし
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.mkdirSync.mockReturnValue(undefined as any);

    // シングルトンをリセットするためモジュールキャッシュをクリア
    vi.resetModules();

    // setInterval がテスト後にリークしないよう fake timers を使う
    vi.useFakeTimers();

    const mod = await import('../../src/session/store.js');
    GetSessionStore = mod.GetSessionStore;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // ResolveCanonicalUserId
  // ============================================================
  describe('ResolveCanonicalUserId', () => {
    const userMappings: UserMapping[] = [
      { github: 'octocat', slack: 'U_SLACK_1', line: 'L_LINE_1', http: 'device-001' },
      { github: 'Hubot', slack: 'U_SLACK_2' },
    ];

    it('source=slack, platformUserId一致 → mapping.github返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('slack', 'U_SLACK_1', userMappings)).toBe('octocat');
    });

    it('source=github, platformUserId一致（大文字小文字無視） → mapping.github返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('github', 'OCTOCAT', userMappings)).toBe('octocat');
      expect(store.ResolveCanonicalUserId('github', 'hubot', userMappings)).toBe('Hubot');
    });

    it('source=line, platformUserId一致 → mapping.github返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('line', 'L_LINE_1', userMappings)).toBe('octocat');
    });

    it('source=http, platformUserId一致 → mapping.github返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('http', 'device-001', userMappings)).toBe('octocat');
    });

    it('マッピングなし → undefined返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('slack', 'U_UNKNOWN', userMappings)).toBeUndefined();
    });

    it('userMappings空配列 → undefined返却', () => {
      const store = GetSessionStore();
      expect(store.ResolveCanonicalUserId('slack', 'U_SLACK_1', [])).toBeUndefined();
    });
  });

  // ============================================================
  // セッションキー生成（Get/Set往復テスト）
  // ============================================================
  describe('セッションキー生成 (Get/Set往復)', () => {
    it('Slack: Set→Get で同じセッションが取得できる', () => {
      const store = GetSessionStore();
      store.Set('thread-1', 'user-1', 'sess-slack-1');
      const result = store.Get('thread-1', 'user-1');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-slack-1');
    });

    it('GitHub: SetForIssue→GetForIssue', () => {
      const store = GetSessionStore();
      store.SetForIssue('owner', 'repo', 42, 'sess-gh-1');
      const result = store.GetForIssue('owner', 'repo', 42);
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-gh-1');
    });

    it('LINE: SetForLine→GetForLine', () => {
      const store = GetSessionStore();
      store.SetForLine('line-user-1', 'sess-line-1');
      const result = store.GetForLine('line-user-1');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-line-1');
    });

    it('HTTP: SetForHttp→GetForHttp', () => {
      const store = GetSessionStore();
      store.SetForHttp('corr-1', 'sess-http-1');
      const result = store.GetForHttp('corr-1');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-http-1');
    });

    it('User (cross-channel): SetForUser→GetForUser', () => {
      const store = GetSessionStore();
      store.SetForUser('canonical-user-1', 'sess-user-1');
      const result = store.GetForUser('canonical-user-1');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-user-1');
    });

    it('User + targetRepo: SetForUser(userId, sessionId, repo)→GetForUser(userId, repo)', () => {
      const store = GetSessionStore();
      store.SetForUser('canonical-user-1', 'sess-user-repo', 'owner/repo');
      const result = store.GetForUser('canonical-user-1', 'owner/repo');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-user-repo');
      // targetRepoなしで取得すると取れない（別キー）
      expect(store.GetForUser('canonical-user-1')).toBeUndefined();
    });

    it('workingDirectory が保存・取得できる', () => {
      const store = GetSessionStore();
      store.Set('thread-wd', 'user-wd', 'sess-wd', '/tmp/work');
      const result = store.Get('thread-wd', 'user-wd');
      expect(result).toBeDefined();
      expect(result!.workingDirectory).toBe('/tmp/work');
    });
  });

  // ============================================================
  // スレッド紐付け
  // ============================================================
  describe('スレッド紐付け', () => {
    it('LinkThreadToIssue→GetIssueForThread', () => {
      const store = GetSessionStore();
      store.LinkThreadToIssue('thread-100', 'owner', 'repo', 7);
      const info = store.GetIssueForThread('thread-100');
      expect(info).toEqual({ owner: 'owner', repo: 'repo', issueNumber: 7 });
    });

    it('LinkThreadToTargetRepo→GetTargetRepoForThread', () => {
      const store = GetSessionStore();
      store.LinkThreadToTargetRepo('thread-200', 'owner/repo');
      expect(store.GetTargetRepoForThread('thread-200')).toBe('owner/repo');
    });

    it('UnlinkThreadForIssue → 紐付け解除', () => {
      const store = GetSessionStore();
      store.LinkThreadToIssue('thread-300', 'owner', 'repo', 10);
      expect(store.GetIssueForThread('thread-300')).toBeDefined();
      store.UnlinkThreadForIssue('owner', 'repo', 10);
      expect(store.GetIssueForThread('thread-300')).toBeUndefined();
    });
  });

  // ============================================================
  // 期限切れ
  // ============================================================
  describe('期限切れ', () => {
    it('maxAge超過のセッション → Get時にundefined', () => {
      const store = GetSessionStore();
      store.Set('thread-exp', 'user-exp', 'sess-exp');

      // 25時間先に進める（デフォルト maxAge は 24h）
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const result = store.Get('thread-exp', 'user-exp');
      expect(result).toBeUndefined();
    });

    it('maxAge以内のセッション → Get時に取得できる', () => {
      const store = GetSessionStore();
      store.Set('thread-ok', 'user-ok', 'sess-ok');

      // 23時間先に進める
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);

      const result = store.Get('thread-ok', 'user-ok');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('sess-ok');
    });
  });

  // ============================================================
  // Delete
  // ============================================================
  describe('Delete', () => {
    it('Slackセッションを削除できる', () => {
      const store = GetSessionStore();
      store.Set('thread-del', 'user-del', 'sess-del');
      expect(store.Get('thread-del', 'user-del')).toBeDefined();
      const deleted = store.Delete('thread-del', 'user-del');
      expect(deleted).toBe(true);
      expect(store.Get('thread-del', 'user-del')).toBeUndefined();
    });

    it('存在しないセッションの削除はfalse', () => {
      const store = GetSessionStore();
      expect(store.Delete('no-thread', 'no-user')).toBe(false);
    });
  });
});

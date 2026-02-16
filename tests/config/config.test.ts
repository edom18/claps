import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// dotenv, admin/store, fs, os をモック
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('../../src/admin/store.js', () => ({
  HasAdminConfig: vi.fn().mockReturnValue(false),
  LoadAdminConfig: vi.fn().mockReturnValue({
    allowedGithubUsers: [],
    allowedSlackUsers: [],
    githubRepos: [],
    userMappings: [],
  }),
}));

vi.mock('fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(false) },
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

let LoadConfig: typeof import('../../src/config.js').LoadConfig;

// 必須環境変数セット
const REQUIRED_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_APP_TOKEN: 'xapp-test-token',
  SLACK_CHANNEL_ID: 'C_TEST',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_REPOS: 'owner/repo',
};

describe('LoadConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    // 全環境変数をクリーン
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    vi.stubEnv('SLACK_APP_TOKEN', '');
    vi.stubEnv('SLACK_CHANNEL_ID', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPOS', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ALLOWED_SLACK_USERS', '');
    vi.stubEnv('ALLOWED_GITHUB_USERS', '');
    vi.stubEnv('ALLOWED_LINE_USERS', '');
    vi.stubEnv('ALLOWED_HTTP_DEVICES', '');
    vi.stubEnv('LINE_CHANNEL_SECRET', '');
    vi.stubEnv('LINE_CHANNEL_TOKEN', '');
    vi.stubEnv('HTTP_CHANNEL_ENABLED', '');
    vi.stubEnv('REFLECTION_ENABLED', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** 全必須環境変数をセットするヘルパー */
  function setRequiredEnv(): void {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
  }

  /** モジュールを再インポート */
  async function reimport(): Promise<void> {
    const mod = await import('../../src/config.js');
    LoadConfig = mod.LoadConfig;
  }

  // --- 正常系 ---
  it('必須環境変数が全て設定 → Config正常返却', async () => {
    setRequiredEnv();
    await reimport();
    const config = LoadConfig();
    expect(config.slackBotToken).toBe('xoxb-test-token');
    expect(config.slackAppToken).toBe('xapp-test-token');
    expect(config.slackChannelId).toBe('C_TEST');
    expect(config.githubToken).toBe('ghp_test');
    expect(config.githubRepos).toEqual(['owner/repo']);
  });

  // --- 必須項目欠落 ---
  it('SLACK_BOT_TOKEN未設定 → Error throw', async () => {
    setRequiredEnv();
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    await reimport();
    expect(() => LoadConfig()).toThrow('SLACK_BOT_TOKEN is required');
  });

  it('SLACK_APP_TOKEN未設定 → Error throw', async () => {
    setRequiredEnv();
    vi.stubEnv('SLACK_APP_TOKEN', '');
    await reimport();
    expect(() => LoadConfig()).toThrow('SLACK_APP_TOKEN is required');
  });

  it('SLACK_CHANNEL_ID未設定 → Error throw', async () => {
    setRequiredEnv();
    vi.stubEnv('SLACK_CHANNEL_ID', '');
    await reimport();
    expect(() => LoadConfig()).toThrow('SLACK_CHANNEL_ID is required');
  });

  it('GITHUB_TOKEN未設定 → Error throw', async () => {
    setRequiredEnv();
    vi.stubEnv('GITHUB_TOKEN', '');
    await reimport();
    expect(() => LoadConfig()).toThrow('GITHUB_TOKEN is required');
  });

  it('GITHUB_REPOS未設定 → Error throw', async () => {
    setRequiredEnv();
    vi.stubEnv('GITHUB_REPOS', '');
    await reimport();
    expect(() => LoadConfig()).toThrow('GITHUB_REPOS is required');
  });

  // --- LINE設定 ---
  it('LINE設定: LINE_CHANNEL_SECRET + LINE_CHANNEL_TOKEN両方あり → channelConfig.line構築', async () => {
    setRequiredEnv();
    vi.stubEnv('LINE_CHANNEL_SECRET', 'line-secret');
    vi.stubEnv('LINE_CHANNEL_TOKEN', 'line-token');
    await reimport();
    const config = LoadConfig();
    expect(config.channelConfig.line).toBeDefined();
    expect(config.channelConfig.line!.channelSecret).toBe('line-secret');
    expect(config.channelConfig.line!.channelToken).toBe('line-token');
    expect(config.channelConfig.line!.webhookPort).toBe(3002);
  });

  it('LINE設定: 片方のみ → channelConfig.line未構築(undefined)', async () => {
    setRequiredEnv();
    vi.stubEnv('LINE_CHANNEL_SECRET', 'line-secret');
    // LINE_CHANNEL_TOKEN は空
    await reimport();
    const config = LoadConfig();
    expect(config.channelConfig.line).toBeUndefined();
  });

  // --- HTTP設定 ---
  it('HTTP設定: HTTP_CHANNEL_ENABLED=true → channelConfig.http構築', async () => {
    setRequiredEnv();
    vi.stubEnv('HTTP_CHANNEL_ENABLED', 'true');
    await reimport();
    const config = LoadConfig();
    expect(config.channelConfig.http).toBeDefined();
    expect(config.channelConfig.http!.enabled).toBe(true);
  });

  it('HTTP設定: HTTP_CHANNEL_ENABLED未設定 → channelConfig.http未構築', async () => {
    setRequiredEnv();
    await reimport();
    const config = LoadConfig();
    expect(config.channelConfig.http).toBeUndefined();
  });

  // --- カンマ区切りパース ---
  it('ALLOWED_SLACK_USERS カンマ区切り → 正しく配列にパース', async () => {
    setRequiredEnv();
    vi.stubEnv('ALLOWED_SLACK_USERS', 'U001, U002 , U003');
    await reimport();
    const config = LoadConfig();
    expect(config.allowedUsers.slack).toEqual(['U001', 'U002', 'U003']);
  });

  it('ALLOWED_LINE_USERS カンマ区切り → 正しく配列にパース', async () => {
    setRequiredEnv();
    vi.stubEnv('ALLOWED_LINE_USERS', 'L001,L002');
    await reimport();
    const config = LoadConfig();
    expect(config.allowedUsers.line).toEqual(['L001', 'L002']);
  });
});

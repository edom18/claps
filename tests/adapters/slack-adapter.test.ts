/**
 * SlackAdapter ユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config, SlackTaskMetadata, NotificationContext, AdapterCallbacks } from '../../src/types/index.js';

// --- Mocks ---

// Persistent mock objects (not affected by mockReset since they're plain objects)
const mockPostMessage = vi.fn();
const mockApp = {
  client: { chat: { postMessage: mockPostMessage } },
  error: vi.fn(),
  use: vi.fn(),
};

vi.mock('../../src/slack/bot.js', () => ({
  InitSlackBot: vi.fn(),
  GetSlackBot: vi.fn(),
  StartSlackBot: vi.fn(),
  StopSlackBot: vi.fn(),
}));

vi.mock('../../src/slack/handlers.js', () => ({
  RegisterSlackHandlers: vi.fn(),
  NotifyTaskStarted: vi.fn(),
  NotifyTaskCompleted: vi.fn(),
  NotifyError: vi.fn(),
  NotifyProgress: vi.fn(),
  NotifyWorkLog: vi.fn(),
  RequestApproval: vi.fn(),
  AskQuestion: vi.fn(),
  CreateIssueThread: vi.fn(),
  PostReflectionResult: vi.fn(),
  SetSuggestionApprovedCallback: vi.fn(),
}));

vi.mock('../../src/channel/formatter.js', () => ({
  SplitMessage: vi.fn(),
}));

// Import after mocks
import { SlackAdapter } from '../../src/slack/adapter.js';
import { InitSlackBot, GetSlackBot, StartSlackBot, StopSlackBot } from '../../src/slack/bot.js';
import { RegisterSlackHandlers, SetSuggestionApprovedCallback } from '../../src/slack/handlers.js';
import { SplitMessage } from '../../src/channel/formatter.js';

// --- Helpers ---

function createConfig(overrides?: Partial<Config>): Config {
  return {
    slackBotToken: 'xoxb-test',
    slackAppToken: 'xapp-test',
    slackChannelId: 'C-TEST',
    githubToken: 'ghp-test',
    githubRepos: [],
    approvalServerPort: 3000,
    githubPollInterval: 60000,
    allowedUsers: {
      github: [],
      slack: ['U-ALLOWED'],
      line: [],
      http: [],
    },
    reflectionConfig: {
      enabled: false,
      schedule: '09:00',
      timezone: 'Asia/Tokyo',
      historyDays: 7,
      maxRecordsPerUser: 50,
    },
    channelConfig: {},
    ...overrides,
  };
}

function createSlackContext(taskId = 'task-1'): NotificationContext {
  const metadata: SlackTaskMetadata = {
    source: 'slack',
    channelId: 'C-TEST',
    threadTs: 'ts-123',
    userId: 'U-ALLOWED',
    messageText: 'test message',
  };
  return { taskId, metadata };
}

function createCallbacks(): AdapterCallbacks {
  return { onMessage: vi.fn().mockResolvedValue(undefined) };
}

// --- Tests ---

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;
  let config: Config;

  beforeEach(() => {
    // Re-setup mock implementations (mockReset clears them)
    mockPostMessage.mockResolvedValue({});
    mockApp.error.mockImplementation(() => {});
    mockApp.use.mockImplementation(() => {});

    vi.mocked(InitSlackBot).mockReturnValue(mockApp as any);
    vi.mocked(GetSlackBot).mockReturnValue(mockApp as any);
    vi.mocked(StartSlackBot).mockResolvedValue(undefined);
    vi.mocked(StopSlackBot).mockResolvedValue(undefined);
    vi.mocked(SplitMessage).mockImplementation((text: string) => [text + '-chunk1', text + '-chunk2']);

    config = createConfig();
    adapter = new SlackAdapter(config);
  });

  describe('getName / getSource', () => {
    it('getName() returns "slack"', () => {
      expect(adapter.getName()).toBe('slack');
    });

    it('getSource() returns "slack"', () => {
      expect(adapter.getSource()).toBe('slack');
    });
  });

  describe('isUserAllowed', () => {
    it('returns true when user is in allowedUsers.slack', () => {
      expect(adapter.isUserAllowed('U-ALLOWED')).toBe(true);
    });

    it('returns false when user is not in allowedUsers.slack', () => {
      expect(adapter.isUserAllowed('U-OTHER')).toBe(false);
    });

    it('returns false when allowedUsers.slack is empty', () => {
      const emptyConfig = createConfig({
        allowedUsers: { github: [], slack: [], line: [], http: [] },
      });
      const emptyAdapter = new SlackAdapter(emptyConfig);
      expect(emptyAdapter.isUserAllowed('U-ALLOWED')).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('returns "stopped" before start', () => {
      const health = adapter.getHealth();
      expect(health).toEqual({ name: 'slack', status: 'stopped' });
    });

    it('returns "healthy" after start', async () => {
      await adapter.init(createCallbacks());
      await adapter.start();
      const health = adapter.getHealth();
      expect(health).toEqual({ name: 'slack', status: 'healthy' });
    });
  });

  describe('init', () => {
    it('calls InitSlackBot with config', async () => {
      await adapter.init(createCallbacks());
      expect(InitSlackBot).toHaveBeenCalledWith(config);
    });
  });

  describe('start', () => {
    it('calls RegisterSlackHandlers and StartSlackBot', async () => {
      const callbacks = createCallbacks();
      await adapter.init(callbacks);
      await adapter.start();

      expect(RegisterSlackHandlers).toHaveBeenCalledWith(
        mockApp,
        config.slackChannelId,
        callbacks.onMessage,
        config.allowedUsers,
      );
      expect(SetSuggestionApprovedCallback).toHaveBeenCalledWith(callbacks.onMessage);
      expect(StartSlackBot).toHaveBeenCalled();
    });

    it('throws if not initialized', async () => {
      await expect(adapter.start()).rejects.toThrow('SlackAdapter not initialized');
    });
  });

  describe('stop', () => {
    it('calls StopSlackBot', async () => {
      await adapter.init(createCallbacks());
      await adapter.start();
      await adapter.stop();

      expect(StopSlackBot).toHaveBeenCalled();
      expect(adapter.getHealth().status).toBe('stopped');
    });
  });

  describe('sendMessage', () => {
    it('calls postMessage with correct params', async () => {
      await adapter.init(createCallbacks());
      const ctx = createSlackContext();

      await adapter.sendMessage(ctx, 'hello');

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C-TEST',
        text: 'hello',
        thread_ts: 'ts-123',
      });
    });
  });

  describe('sendSplitMessage', () => {
    it('splits message and posts each chunk', async () => {
      await adapter.init(createCallbacks());
      const ctx = createSlackContext();

      await adapter.sendSplitMessage(ctx, 'long text');

      expect(SplitMessage).toHaveBeenCalledWith('long text', 4000);
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C-TEST',
        text: 'long text-chunk1',
        thread_ts: 'ts-123',
      });
      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C-TEST',
        text: 'long text-chunk2',
        thread_ts: 'ts-123',
      });
    });
  });
});

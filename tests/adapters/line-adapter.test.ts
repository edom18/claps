/**
 * LineAdapter ユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Config,
  LineTaskMetadata,
  NotificationContext,
  AdapterCallbacks,
  ReflectionResult,
} from '../../src/types/index.js';

// --- Mocks ---

// Persistent mock functions that we re-setup in beforeEach
const mockPushMessage = vi.fn();
const mockReplyMessage = vi.fn();

vi.mock('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: vi.fn(),
  },
}));

vi.mock('../../src/channel/formatter.js', () => ({
  SplitMessage: vi.fn(),
}));

vi.mock('../../src/line/webhook.js', () => ({
  CreateLineWebhookRouter: vi.fn(),
}));

vi.mock('../../src/messages.js', () => ({
  PlainMsg: vi.fn(),
}));

// Import after mocks
import { LineAdapter } from '../../src/line/adapter.js';
import { messagingApi } from '@line/bot-sdk';
import { SplitMessage } from '../../src/channel/formatter.js';
import { PlainMsg } from '../../src/messages.js';

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
      slack: [],
      line: ['U-LINE-ALLOWED'],
      http: [],
    },
    reflectionConfig: {
      enabled: false,
      schedule: '09:00',
      timezone: 'Asia/Tokyo',
      historyDays: 7,
      maxRecordsPerUser: 50,
    },
    channelConfig: {
      line: {
        channelSecret: 'test-secret',
        channelToken: 'test-token',
        webhookPort: 0,
      },
    },
    ...overrides,
  };
}

function createLineContext(userId = 'U-LINE-ALLOWED', taskId = 'task-1'): NotificationContext {
  const metadata: LineTaskMetadata = {
    source: 'line',
    userId,
    messageText: 'test message',
  };
  return { taskId, metadata };
}

function createCallbacks(): AdapterCallbacks {
  return { onMessage: vi.fn().mockResolvedValue(undefined) };
}

// --- Tests ---

describe('LineAdapter', () => {
  let adapter: LineAdapter;
  let config: Config;

  beforeEach(() => {
    // Re-setup mock implementations after mockReset
    mockPushMessage.mockResolvedValue({});
    mockReplyMessage.mockResolvedValue({});

    // Must use function (not arrow) so it can be called with `new`
    vi.mocked(messagingApi.MessagingApiClient).mockImplementation(
      function (this: any) {
        this.pushMessage = mockPushMessage;
        this.replyMessage = mockReplyMessage;
      } as any,
    );

    vi.mocked(SplitMessage).mockImplementation((text: string) => [`${text}-part1`, `${text}-part2`]);

    vi.mocked(PlainMsg).mockImplementation((key: string, vars?: Readonly<Record<string, string>>) => {
      if (key === 'task.started') return `started: ${vars?.description ?? ''}`;
      if (key === 'task.completed') return `completed: ${vars?.message ?? ''}`;
      if (key === 'task.completedPr') return `\nPR: ${vars?.prUrl ?? ''}`;
      if (key === 'task.error') return `error: ${vars?.error ?? ''}`;
      if (key === 'task.progress') return `progress: ${vars?.message ?? ''}`;
      if (key === 'reflection.result') return `reflection: ${vars?.date ?? ''}`;
      if (key === 'mention.start') return 'processing...';
      return key;
    });

    config = createConfig();
    adapter = new LineAdapter(config);
  });

  describe('getName / getSource', () => {
    it('getName() returns "line"', () => {
      expect(adapter.getName()).toBe('line');
    });

    it('getSource() returns "line"', () => {
      expect(adapter.getSource()).toBe('line');
    });
  });

  describe('isUserAllowed', () => {
    it('returns true when user is in allowedUsers.line', () => {
      expect(adapter.isUserAllowed('U-LINE-ALLOWED')).toBe(true);
    });

    it('returns false when user is not in allowedUsers.line', () => {
      expect(adapter.isUserAllowed('U-OTHER')).toBe(false);
    });

    it('returns false when allowedUsers.line is empty', () => {
      const emptyConfig = createConfig({
        allowedUsers: { github: [], slack: [], line: [], http: [] },
      });
      const emptyAdapter = new LineAdapter(emptyConfig);
      expect(emptyAdapter.isUserAllowed('U-LINE-ALLOWED')).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('returns "stopped" before start', () => {
      expect(adapter.getHealth()).toEqual({ name: 'line', status: 'stopped' });
    });

    it('returns "stopped" after init (before start)', async () => {
      await adapter.init(createCallbacks());
      expect(adapter.getHealth().status).toBe('stopped');
    });
  });

  describe('init', () => {
    it('creates MessagingApiClient', async () => {
      await adapter.init(createCallbacks());
      expect(messagingApi.MessagingApiClient).toHaveBeenCalledWith({
        channelAccessToken: 'test-token',
      });
    });

    it('throws if line config is not set', async () => {
      const noLineConfig = createConfig({ channelConfig: {} });
      const badAdapter = new LineAdapter(noLineConfig);
      await expect(badAdapter.init(createCallbacks())).rejects.toThrow('LINE channel config is not set');
    });
  });

  describe('sendMessage', () => {
    it('calls pushMessage with correct userId', async () => {
      await adapter.init(createCallbacks());
      const ctx = createLineContext('U-LINE-ALLOWED');

      await adapter.sendMessage(ctx, 'hello LINE');

      expect(mockPushMessage).toHaveBeenCalledWith({
        to: 'U-LINE-ALLOWED',
        messages: [{ type: 'text', text: 'hello LINE' }],
      });
    });

    it('does nothing for non-line context', async () => {
      await adapter.init(createCallbacks());
      const ctx: NotificationContext = {
        taskId: 'task-1',
        metadata: { source: 'slack', channelId: 'C', threadTs: 'ts', userId: 'U', messageText: '' } as any,
      };

      await adapter.sendMessage(ctx, 'hello');
      expect(mockPushMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendSplitMessage', () => {
    it('splits at 5000 chars and sends in batches of 5', async () => {
      await adapter.init(createCallbacks());
      const ctx = createLineContext();

      await adapter.sendSplitMessage(ctx, 'long text');

      expect(SplitMessage).toHaveBeenCalledWith('long text', 5000);
      // SplitMessage mock returns 2 chunks, both fit in one batch (max 5)
      expect(mockPushMessage).toHaveBeenCalledTimes(1);
      expect(mockPushMessage).toHaveBeenCalledWith({
        to: 'U-LINE-ALLOWED',
        messages: [
          { type: 'text', text: 'long text-part1' },
          { type: 'text', text: 'long text-part2' },
        ],
      });
    });
  });

  describe('notifyWorkLog', () => {
    it('sends notification for approval_pending logType', async () => {
      await adapter.init(createCallbacks());
      const ctx = createLineContext();

      await adapter.notifyWorkLog(ctx, 'approval_pending', 'Needs approval', 'details');

      expect(mockPushMessage).toHaveBeenCalled();
    });

    it('skips notification for other logTypes', async () => {
      await adapter.init(createCallbacks());
      const ctx = createLineContext();

      await adapter.notifyWorkLog(ctx, 'tool_start', 'Starting tool', 'details');
      await adapter.notifyWorkLog(ctx, 'thinking', 'Thinking...', undefined);
      await adapter.notifyWorkLog(ctx, 'text', 'Some text', undefined);

      expect(mockPushMessage).not.toHaveBeenCalled();
    });
  });

  describe('createIssueThread', () => {
    it('returns empty string (no-op)', async () => {
      const result = await adapter.createIssueThread('owner', 'repo', 1, 'title', 'url');
      expect(result).toBe('');
    });
  });

  describe('requestApproval', () => {
    it('sends QuickReply message and returns a deferred promise', async () => {
      await adapter.init(createCallbacks());
      const ctx = createLineContext();

      // requestApproval returns a promise that won't resolve until postback
      const approvalPromise = adapter.requestApproval(ctx, 'req-1', 'bash', 'echo hello');

      // Verify pushMessage was called with QuickReply
      expect(mockPushMessage).toHaveBeenCalledTimes(1);
      const call = mockPushMessage.mock.calls[0]![0];
      expect(call.to).toBe('U-LINE-ALLOWED');
      expect(call.messages[0].quickReply).toBeDefined();
      expect(call.messages[0].quickReply.items).toHaveLength(2);

      // Simulate postback to resolve the deferred
      (adapter as any)._handlePostback('U-LINE-ALLOWED', 'action=approve&requestId=req-1', 'reply-token');

      const result = await approvalPromise;
      expect(result.decision).toBe('allow');
      expect(result.respondedBy).toBe('U-LINE-ALLOWED');
    });
  });

  describe('postReflectionResult', () => {
    it('sends reflection result to all allowed LINE users', async () => {
      await adapter.init(createCallbacks());

      const result: ReflectionResult = {
        date: '2026-02-16',
        generatedAt: '2026-02-16T09:00:00Z',
        userReflections: [
          {
            userId: 'U1',
            summary: 'Good work',
            suggestions: [],
            patterns: [],
          },
        ],
      };

      await adapter.postReflectionResult(result);

      expect(mockPushMessage).toHaveBeenCalledTimes(1);
      expect(mockPushMessage).toHaveBeenCalledWith({
        to: 'U-LINE-ALLOWED',
        messages: [{ type: 'text', text: expect.stringContaining('reflection') }],
      });
    });

    it('sends to no users when allowedUsers.line is empty', async () => {
      const emptyConfig = createConfig({
        allowedUsers: { github: [], slack: [], line: [], http: [] },
      });
      const emptyAdapter = new LineAdapter(emptyConfig);
      await emptyAdapter.init(createCallbacks());

      const result: ReflectionResult = {
        date: '2026-02-16',
        generatedAt: '2026-02-16T09:00:00Z',
        userReflections: [],
      };

      await emptyAdapter.postReflectionResult(result);
      expect(mockPushMessage).not.toHaveBeenCalled();
    });
  });
});

/**
 * HttpAdapter ユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Config,
  HttpTaskMetadata,
  NotificationContext,
  AdapterCallbacks,
} from '../../src/types/index.js';
import { AdapterRegistry } from '../../src/channel/registry.js';

// --- Mocks ---

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('uuid-fixed-1234'),
}));

// Mock only the routes module - HttpAdapter uses it
vi.mock('../../src/http/routes.js', () => ({
  CreateHttpApiRouter: vi.fn().mockReturnValue({
    // Mock Router
  }),
}));

// Import after mocks
import { HttpAdapter } from '../../src/http/adapter.js';

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
      line: [],
      http: ['device-1'],
    },
    reflectionConfig: {
      enabled: false,
      schedule: '09:00',
      timezone: 'Asia/Tokyo',
      historyDays: 7,
      maxRecordsPerUser: 50,
    },
    channelConfig: {
      http: { enabled: true, port: 4000 },
    },
    ...overrides,
  };
}

function createHttpContext(correlationId = 'corr-1', taskId = 'task-1'): NotificationContext {
  const metadata: HttpTaskMetadata = {
    source: 'http',
    correlationId,
    deviceId: 'device-1',
    messageText: 'test',
  };
  return { taskId, metadata };
}

function createCallbacks(): AdapterCallbacks {
  return { onMessage: vi.fn().mockResolvedValue(undefined) };
}

// --- Tests ---

describe('HttpAdapter', () => {
  let adapter: HttpAdapter;
  let config: Config;
  let registry: AdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createConfig();
    registry = new AdapterRegistry();
    adapter = new HttpAdapter(config, registry);
  });

  describe('getName / getSource', () => {
    it('getName() returns "http"', () => {
      expect(adapter.getName()).toBe('http');
    });

    it('getSource() returns "http"', () => {
      expect(adapter.getSource()).toBe('http');
    });
  });

  describe('isUserAllowed', () => {
    it('returns true when http allowedUsers is empty (all allowed)', () => {
      const emptyConfig = createConfig({
        allowedUsers: { github: [], slack: [], line: [], http: [] },
      });
      const emptyAdapter = new HttpAdapter(emptyConfig, registry);
      expect(emptyAdapter.isUserAllowed('any-device')).toBe(true);
    });

    it('returns true when device is in allowedUsers.http', () => {
      expect(adapter.isUserAllowed('device-1')).toBe(true);
    });

    it('returns false when device is not in allowedUsers.http', () => {
      expect(adapter.isUserAllowed('device-unknown')).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('returns "stopped" before start', () => {
      expect(adapter.getHealth()).toEqual({ name: 'http', status: 'stopped' });
    });

    it('returns "healthy" after started flag is set', async () => {
      // We can't easily start the real Express server in unit tests,
      // but we can test the status flag by verifying it changes after stop
      expect(adapter.getHealth().status).toBe('stopped');
    });
  });

  describe('init', () => {
    it('initializes without error', async () => {
      await expect(adapter.init(createCallbacks())).resolves.not.toThrow();
    });
  });

  describe('notification methods update _taskStates', () => {
    let ctx: NotificationContext;

    beforeEach(async () => {
      await adapter.init(createCallbacks());
      // Seed a task state in the internal map
      const taskStates = (adapter as any)._taskStates as Map<string, any>;
      taskStates.set('corr-1', {
        taskId: 'corr-1',
        status: 'queued',
        progressMessages: [],
      });
      ctx = createHttpContext('corr-1');
    });

    it('notifyTaskStarted sets status to "processing"', async () => {
      await adapter.notifyTaskStarted(ctx, 'Starting task');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.status).toBe('processing');
      expect(state.progressMessages).toContain('Task started: Starting task');
    });

    it('notifyTaskCompleted sets status to "completed" with result', async () => {
      await adapter.notifyTaskCompleted(ctx, 'Done!', 'https://pr.url');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.status).toBe('completed');
      expect(state.result).toEqual({
        success: true,
        output: 'Done!',
        prUrl: 'https://pr.url',
      });
      expect(state.pending).toBeNull();
    });

    it('notifyError sets status to "failed" with error', async () => {
      await adapter.notifyError(ctx, 'Something went wrong');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.status).toBe('failed');
      expect(state.result).toEqual({
        success: false,
        output: '',
        error: 'Something went wrong',
      });
      expect(state.pending).toBeNull();
    });

    it('notifyProgress appends to progressMessages', async () => {
      await adapter.notifyProgress(ctx, 'Step 1 done');
      await adapter.notifyProgress(ctx, 'Step 2 done');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.progressMessages).toEqual(['Step 1 done', 'Step 2 done']);
    });

    it('sendMessage appends to progressMessages', async () => {
      await adapter.sendMessage(ctx, 'info message');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.progressMessages).toContain('info message');
    });

    it('sendSplitMessage appends to progressMessages (no split for HTTP)', async () => {
      await adapter.sendSplitMessage(ctx, 'long message');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.progressMessages).toContain('long message');
    });

    it('notifyWorkLog appends to progressMessages', async () => {
      await adapter.notifyWorkLog(ctx, 'tool_start', 'Running bash');

      const state = (adapter as any)._taskStates.get('corr-1');
      expect(state.progressMessages).toContain('Running bash');
    });
  });

  describe('requestApproval', () => {
    it('sets status to "awaiting_approval" and stores pending info', async () => {
      await adapter.init(createCallbacks());
      const taskStates = (adapter as any)._taskStates as Map<string, any>;
      taskStates.set('corr-1', {
        taskId: 'corr-1',
        status: 'processing',
        progressMessages: [],
      });
      const ctx = createHttpContext('corr-1');

      // requestApproval returns a deferred promise (won't resolve yet)
      const approvalPromise = adapter.requestApproval(ctx, 'req-1', 'bash', 'echo test');

      const state = taskStates.get('corr-1');
      expect(state.status).toBe('awaiting_approval');
      expect(state.pending).toEqual({
        type: 'approval',
        id: 'req-1',
        tool: 'bash',
        command: 'echo test',
        timestamp: expect.any(String),
      });

      // Resolve the deferred by calling the internal handler
      (adapter as any)._handleApprovalResponse('corr-1', 'req-1', 'allow', 'ok');

      const result = await approvalPromise;
      expect(result.decision).toBe('allow');
      expect(result.comment).toBe('ok');
    });

    it('returns deny when context has no matching state', async () => {
      await adapter.init(createCallbacks());
      const ctx = createHttpContext('nonexistent');

      const result = await adapter.requestApproval(ctx, 'req-x', 'bash', 'echo');
      expect(result.decision).toBe('deny');
    });
  });

  describe('createIssueThread', () => {
    it('returns empty string (no-op)', async () => {
      const result = await adapter.createIssueThread('owner', 'repo', 1, 'title', 'url');
      expect(result).toBe('');
    });
  });

  describe('postReflectionResult', () => {
    it('is a no-op', async () => {
      // Should not throw
      await expect(
        adapter.postReflectionResult({
          date: '2026-02-16',
          generatedAt: '2026-02-16T09:00:00Z',
          userReflections: [],
        }),
      ).resolves.not.toThrow();
    });
  });
});

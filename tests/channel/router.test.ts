import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationRouter } from '../../src/channel/router.js';
import { AdapterRegistry } from '../../src/channel/registry.js';
import { createMockAdapter } from '../helpers/mock-adapter.js';
import type { TaskMetadata, SlackTaskMetadata, GitHubTaskMetadata, ReflectionResult, AdapterCallbacks } from '../../src/types/index.js';

describe('NotificationRouter', () => {
  let registry: AdapterRegistry;
  let router: NotificationRouter;
  const mockCallbacks: AdapterCallbacks = {
    onMessage: vi.fn().mockResolvedValue(undefined),
  };

  const slackMetadata: SlackTaskMetadata = {
    source: 'slack',
    channelId: 'C123',
    threadTs: '1234.5678',
    userId: 'U123',
    messageText: 'test',
  };

  const githubMetadata: GitHubTaskMetadata = {
    source: 'github',
    owner: 'test-owner',
    repo: 'test-repo',
    issueNumber: 1,
    issueTitle: 'Test Issue',
    issueUrl: 'https://github.com/test-owner/test-repo/issues/1',
  };

  const mockReflectionResult: ReflectionResult = {
    date: '2026-02-16',
    generatedAt: '2026-02-16T00:00:00Z',
    userReflections: [],
  };

  beforeEach(async () => {
    registry = new AdapterRegistry();
  });

  describe('sendMessage', () => {
    it('sourceに対応するアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.sendMessage('task-1', slackMetadata, 'hello');

      expect(slackAdapter.sendMessage).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'hello'
      );
    });

    it('対応アダプタなしの場合デフォルトにフォールバック', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      // githubアダプタは未登録 → デフォルト(slack)にフォールバック
      await router.sendMessage('task-1', githubMetadata, 'hello');

      expect(slackAdapter.sendMessage).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: githubMetadata },
        'hello'
      );
    });

    it('アダプタもデフォルトもなしの場合Errorをthrowする', async () => {
      router = new NotificationRouter(registry);

      await expect(
        router.sendMessage('task-1', slackMetadata, 'hello')
      ).rejects.toThrow('No adapter found for source: slack');
    });
  });

  describe('notifyTaskStarted', () => {
    it('正しいアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.notifyTaskStarted('task-1', slackMetadata, 'Starting task');

      expect(slackAdapter.notifyTaskStarted).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'Starting task'
      );
    });
  });

  describe('notifyTaskCompleted', () => {
    it('正しいアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.notifyTaskCompleted('task-1', slackMetadata, 'Done', 'https://pr.url');

      expect(slackAdapter.notifyTaskCompleted).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'Done',
        'https://pr.url'
      );
    });
  });

  describe('notifyError', () => {
    it('正しいアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.notifyError('task-1', slackMetadata, 'Something failed');

      expect(slackAdapter.notifyError).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'Something failed'
      );
    });
  });

  describe('notifyProgress', () => {
    it('正しいアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.notifyProgress('task-1', slackMetadata, '50% done');

      expect(slackAdapter.notifyProgress).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        '50% done'
      );
    });
  });

  describe('notifyWorkLog', () => {
    it('正しいアダプタに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      await router.notifyWorkLog('task-1', slackMetadata, 'info', 'log message', 'details');

      expect(slackAdapter.notifyWorkLog).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'info',
        'log message',
        'details'
      );
    });
  });

  describe('requestApproval', () => {
    it('正しいアダプタに委譲しApprovalResultを返す', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      const result = await router.requestApproval(
        'task-1', slackMetadata, 'req-1', 'bash', 'ls -la', 'U123'
      );

      expect(slackAdapter.requestApproval).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'req-1', 'bash', 'ls -la', 'U123'
      );
      expect(result).toEqual({ decision: 'allow' });
    });
  });

  describe('askQuestion', () => {
    it('正しいアダプタに委譲しstring返却', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      const answer = await router.askQuestion(
        'task-1', slackMetadata, 'q-1', 'Which option?', ['A', 'B']
      );

      expect(slackAdapter.askQuestion).toHaveBeenCalledWith(
        { taskId: 'task-1', metadata: slackMetadata },
        'q-1', 'Which option?', ['A', 'B']
      );
      expect(answer).toBe('answer');
    });
  });

  describe('postReflectionResult', () => {
    it('全アクティブアダプタに送信される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);
      await registry.initAll(mockCallbacks);
      await registry.startAll();
      router = new NotificationRouter(registry);

      await router.postReflectionResult(mockReflectionResult);

      expect(slackAdapter.postReflectionResult).toHaveBeenCalledWith(mockReflectionResult);
      expect(lineAdapter.postReflectionResult).toHaveBeenCalledWith(mockReflectionResult);
    });

    it('アクティブアダプタが0件の場合エラーなし', async () => {
      router = new NotificationRouter(registry);

      // アダプタ未登録でもエラーをthrowしない
      await expect(router.postReflectionResult(mockReflectionResult)).resolves.toBeUndefined();
    });

    it('1つ失敗しても他には送信される（障害隔離）', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);
      await registry.initAll(mockCallbacks);
      await registry.startAll();
      router = new NotificationRouter(registry);

      slackAdapter.postReflectionResult.mockRejectedValueOnce(new Error('post failed'));

      await router.postReflectionResult(mockReflectionResult);

      expect(slackAdapter.postReflectionResult).toHaveBeenCalledWith(mockReflectionResult);
      expect(lineAdapter.postReflectionResult).toHaveBeenCalledWith(mockReflectionResult);
    });
  });

  describe('createIssueThread', () => {
    it('デフォルトアダプタのみに委譲される', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      registry.register(slackAdapter);
      router = new NotificationRouter(registry);

      const threadTs = await router.createIssueThread(
        'owner', 'repo', 42, 'Issue Title', 'https://github.com/owner/repo/issues/42'
      );

      expect(slackAdapter.createIssueThread).toHaveBeenCalledWith(
        'owner', 'repo', 42, 'Issue Title', 'https://github.com/owner/repo/issues/42'
      );
      expect(threadTs).toBe('mock-thread-ts');
    });

    it('デフォルトなしの場合空文字列を返す', async () => {
      router = new NotificationRouter(registry);

      const threadTs = await router.createIssueThread(
        'owner', 'repo', 42, 'Issue Title', 'https://github.com/owner/repo/issues/42'
      );

      expect(threadTs).toBe('');
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task, TaskResult, WorkHistoryRecord } from '../../src/types/index.js';

// history/store と admin/store をモック
const mockAppend = vi.fn();
vi.mock('../../src/history/store.js', () => ({
  GetHistoryStore: vi.fn(() => ({ Append: mockAppend })),
}));

vi.mock('../../src/admin/store.js', () => ({
  GetSlackUserForGitHub: vi.fn((ghUser: string) => {
    if (ghUser === 'octocat') return 'U_SLACK_OCTOCAT';
    return undefined;
  }),
  GetAdminConfig: vi.fn(() => ({
    allowedGithubUsers: [],
    allowedSlackUsers: [],
    githubRepos: [],
    userMappings: [],
  })),
}));

import { RecordTaskCompletion } from '../../src/history/recorder.js';

// ============================================================
// テストヘルパー
// ============================================================

function makeSlackTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-slack-1',
    source: 'slack',
    createdAt: new Date('2026-02-16T00:00:00Z'),
    startedAt: new Date('2026-02-16T00:00:00Z'),
    completedAt: new Date('2026-02-16T00:01:00Z'),
    prompt: 'Fix the bug',
    status: 'completed',
    metadata: {
      source: 'slack',
      channelId: 'C_TEST',
      threadTs: 'ts-1',
      userId: 'U_SLACK_1',
      messageText: 'Fix the bug',
    },
    ...overrides,
  };
}

function makeGitHubTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-gh-1',
    source: 'github',
    createdAt: new Date('2026-02-16T00:00:00Z'),
    startedAt: new Date('2026-02-16T00:00:00Z'),
    completedAt: new Date('2026-02-16T00:02:00Z'),
    prompt: 'Implement feature',
    status: 'completed',
    metadata: {
      source: 'github',
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
      issueTitle: 'Feature request',
      issueUrl: 'https://github.com/owner/repo/issues/42',
      requestingUser: 'octocat',
    },
    ...overrides,
  };
}

function makeLineTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-line-1',
    source: 'line',
    createdAt: new Date('2026-02-16T00:00:00Z'),
    startedAt: new Date('2026-02-16T00:00:00Z'),
    completedAt: new Date('2026-02-16T00:01:30Z'),
    prompt: 'Deploy service',
    status: 'completed',
    metadata: {
      source: 'line',
      userId: 'L_USER_1',
      messageText: 'Deploy service',
    },
    ...overrides,
  };
}

function makeHttpTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-http-1',
    source: 'http',
    createdAt: new Date('2026-02-16T00:00:00Z'),
    startedAt: new Date('2026-02-16T00:00:00Z'),
    completedAt: new Date('2026-02-16T00:03:00Z'),
    prompt: 'Run diagnostics',
    status: 'completed',
    metadata: {
      source: 'http',
      correlationId: 'corr-1',
      deviceId: 'device-001',
      messageText: 'Run diagnostics',
    },
    ...overrides,
  };
}

const successResult: TaskResult = {
  success: true,
  output: 'Done successfully',
};

describe('history/recorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // RecordTaskCompletion — sourceChannel
  // ============================================================
  describe('RecordTaskCompletion', () => {
    it('Slackタスク → sourceChannel=slack でWorkHistoryRecordが記録される', () => {
      RecordTaskCompletion(makeSlackTask(), successResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.sourceChannel).toBe('slack');
      expect(record.userId).toBe('U_SLACK_1');
      expect(record.result).toBe('success');
    });

    it('GitHubタスク → sourceChannel=github, userId=Slack mapping', () => {
      RecordTaskCompletion(makeGitHubTask(), successResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.sourceChannel).toBe('github');
      expect(record.userId).toBe('U_SLACK_OCTOCAT');
      expect(record.repo).toBe('owner/repo');
      expect(record.issueNumber).toBe(42);
    });

    it('LINEタスク → sourceChannel=line', () => {
      RecordTaskCompletion(makeLineTask(), successResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.sourceChannel).toBe('line');
      expect(record.userId).toBe('L_USER_1');
    });

    it('HTTPタスク → sourceChannel=http, deviceId使用', () => {
      RecordTaskCompletion(makeHttpTask(), successResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.sourceChannel).toBe('http');
      expect(record.userId).toBe('device-001');
    });

    it('HTTPタスク deviceId無し → correlationIdがuserIdになる', () => {
      const task = makeHttpTask();
      // deviceId を除外
      (task.metadata as any).deviceId = undefined;
      RecordTaskCompletion(task, successResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.userId).toBe('corr-1');
    });

    it('GitHubタスク requestingUser未マッピング → 記録スキップ', () => {
      const task = makeGitHubTask();
      (task.metadata as any).requestingUser = 'unknown-user';
      RecordTaskCompletion(task, successResult);
      // GetSlackUserForGitHub returns undefined for unknown-user → userId=undefined → skip
      expect(mockAppend).not.toHaveBeenCalled();
    });

    it('失敗結果 → result=failure が記録される', () => {
      const failResult: TaskResult = { success: false, output: 'Error occurred', error: 'timeout' };
      RecordTaskCompletion(makeSlackTask(), failResult);
      expect(mockAppend).toHaveBeenCalledTimes(1);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.result).toBe('failure');
    });

    it('長いprompt → 200文字に切り詰め', () => {
      const longPrompt = 'a'.repeat(300);
      const task = makeSlackTask({ prompt: longPrompt });
      RecordTaskCompletion(task, successResult);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.prompt.length).toBe(200);
    });

    it('長い出力 → summary が300文字に切り詰め', () => {
      const longOutput = 'b'.repeat(500);
      const result: TaskResult = { success: true, output: longOutput };
      RecordTaskCompletion(makeSlackTask(), result);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.summary.length).toBe(300);
    });

    it('prUrl がある場合 → レコードに含まれる', () => {
      const result: TaskResult = { success: true, output: 'Done', prUrl: 'https://github.com/o/r/pull/1' };
      RecordTaskCompletion(makeSlackTask(), result);
      const record = mockAppend.mock.calls[0]![0] as WorkHistoryRecord;
      expect(record.prUrl).toBe('https://github.com/o/r/pull/1');
    });
  });
});

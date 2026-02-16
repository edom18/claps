import { vi } from 'vitest';
import type { ChannelAdapter } from '../../src/channel/adapter.js';
import type { TaskSource, HealthStatus, AdapterCallbacks, NotificationContext, ApprovalResult, ReflectionResult } from '../../src/types/index.js';

export function createMockAdapter(source: TaskSource = 'slack', name?: string): ChannelAdapter & { [K in keyof ChannelAdapter]: ReturnType<typeof vi.fn> } {
  return {
    getName: vi.fn().mockReturnValue(name ?? source),
    getSource: vi.fn().mockReturnValue(source),
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn().mockReturnValue({ name: name ?? source, status: 'healthy' } as HealthStatus),
    isUserAllowed: vi.fn().mockReturnValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendSplitMessage: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue({ decision: 'allow' } as ApprovalResult),
    askQuestion: vi.fn().mockResolvedValue('answer'),
    notifyTaskStarted: vi.fn().mockResolvedValue(undefined),
    notifyTaskCompleted: vi.fn().mockResolvedValue(undefined),
    notifyError: vi.fn().mockResolvedValue(undefined),
    notifyProgress: vi.fn().mockResolvedValue(undefined),
    notifyWorkLog: vi.fn().mockResolvedValue(undefined),
    postReflectionResult: vi.fn().mockResolvedValue(undefined),
    createIssueThread: vi.fn().mockResolvedValue('mock-thread-ts'),
  };
}

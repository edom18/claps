/**
 * HTTP Routes (CreateHttpApiRouter) ユニットテスト
 * supertest を使用して Express ルートをテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';
import { CreateHttpApiRouter, type HttpRoutesDeps, type PendingTaskState } from '../../src/http/routes.js';
import type { HealthStatus } from '../../src/types/index.js';

// --- Helpers ---

function createDeps(overrides?: Partial<HttpRoutesDeps>): HttpRoutesDeps {
  return {
    getTaskState: vi.fn().mockReturnValue(undefined),
    onMessage: vi.fn().mockReturnValue('task-id-123'),
    onApprovalResponse: vi.fn().mockReturnValue(true),
    onAnswerResponse: vi.fn().mockReturnValue(true),
    registry: {
      getHealthAll: vi.fn().mockReturnValue({
        slack: { name: 'slack', status: 'healthy' } as HealthStatus,
        http: { name: 'http', status: 'healthy' } as HealthStatus,
      }),
    } as any,
    validateToken: vi.fn().mockReturnValue(true),
    isDeviceAllowed: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function createApp(deps: HttpRoutesDeps): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', CreateHttpApiRouter(deps));
  return app;
}

const VALID_AUTH = 'Bearer valid-token';

// --- Tests ---

describe('HTTP Routes (CreateHttpApiRouter)', () => {
  let deps: HttpRoutesDeps;
  let app: Express;

  beforeEach(() => {
    deps = createDeps();
    app = createApp(deps);
  });

  describe('POST /api/v1/messages', () => {
    it('returns 202 with taskId on valid message', async () => {
      const res = await request(app)
        .post('/api/v1/messages')
        .set('Authorization', VALID_AUTH)
        .send({ message: 'Hello', deviceId: 'dev-1' });

      expect(res.status).toBe(202);
      expect(res.body.taskId).toBe('task-id-123');
      expect(res.body.status).toBe('queued');
      expect(res.body.pollUrl).toBe('/api/v1/tasks/task-id-123');
      expect(deps.onMessage).toHaveBeenCalledWith('Hello', 'dev-1', undefined);
    });

    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/api/v1/messages')
        .set('Authorization', VALID_AUTH)
        .send({ deviceId: 'dev-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('message is required');
    });

    it('returns 400 when message is empty string', async () => {
      const res = await request(app)
        .post('/api/v1/messages')
        .set('Authorization', VALID_AUTH)
        .send({ message: '  ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('message is required');
    });

    it('returns 403 when device is not allowed', async () => {
      deps = createDeps({ isDeviceAllowed: vi.fn().mockReturnValue(false) });
      app = createApp(deps);

      const res = await request(app)
        .post('/api/v1/messages')
        .set('Authorization', VALID_AUTH)
        .send({ message: 'Hello', deviceId: 'bad-device' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Device not allowed');
    });

    it('returns 401 when no auth token', async () => {
      const res = await request(app)
        .post('/api/v1/messages')
        .send({ message: 'Hello' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 when token is invalid', async () => {
      deps = createDeps({ validateToken: vi.fn().mockReturnValue(false) });
      app = createApp(deps);

      const res = await request(app)
        .post('/api/v1/messages')
        .set('Authorization', 'Bearer bad-token')
        .send({ message: 'Hello' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('GET /api/v1/tasks/:taskId', () => {
    it('returns 200 with task state when found', async () => {
      const taskState: PendingTaskState = {
        taskId: 'task-1',
        status: 'processing',
        progressMessages: ['Step 1 done'],
        pending: null,
      };
      deps = createDeps({ getTaskState: vi.fn().mockReturnValue(taskState) });
      app = createApp(deps);

      const res = await request(app)
        .get('/api/v1/tasks/task-1')
        .set('Authorization', VALID_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe('task-1');
      expect(res.body.status).toBe('processing');
      expect(res.body.pending).toBeNull();
    });

    it('returns 404 when task not found', async () => {
      const res = await request(app)
        .get('/api/v1/tasks/nonexistent')
        .set('Authorization', VALID_AUTH);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });
  });

  describe('POST /api/v1/tasks/:taskId/approve', () => {
    it('returns 200 on successful approval', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/task-1/approve')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-1', decision: 'allow' });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.requestId).toBe('req-1');
      expect(res.body.decision).toBe('allow');
      expect(deps.onApprovalResponse).toHaveBeenCalledWith('task-1', 'req-1', 'allow', undefined);
    });

    it('returns 400 when requestId or decision is missing', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/task-1/approve')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('requestId and decision');
    });

    it('returns 400 when decision is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/task-1/approve')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-1', decision: 'maybe' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when approval request not found', async () => {
      deps = createDeps({ onApprovalResponse: vi.fn().mockReturnValue(false) });
      app = createApp(deps);

      const res = await request(app)
        .post('/api/v1/tasks/task-1/approve')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-expired', decision: 'allow' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found or expired');
    });
  });

  describe('POST /api/v1/tasks/:taskId/answer', () => {
    it('returns 200 on successful answer', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/task-1/answer')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-1', answer: 'Option A' });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.answer).toBe('Option A');
      expect(deps.onAnswerResponse).toHaveBeenCalledWith('task-1', 'req-1', 'Option A');
    });

    it('returns 400 when requestId or answer is missing', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/task-1/answer')
        .set('Authorization', VALID_AUTH)
        .send({ requestId: 'req-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('requestId and answer');
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 without auth (health is public)', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.channels).toEqual({
        slack: 'healthy',
        http: 'healthy',
      });
    });
  });
});

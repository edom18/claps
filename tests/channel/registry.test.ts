import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdapterRegistry } from '../../src/channel/registry.js';
import { createMockAdapter } from '../helpers/mock-adapter.js';
import type { AdapterCallbacks } from '../../src/types/index.js';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;
  const mockCallbacks: AdapterCallbacks = {
    onMessage: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe('register', () => {
    it('正常登録するとgetAdapterで取得可能', () => {
      const adapter = createMockAdapter('slack', 'Slack');
      registry.register(adapter);
      expect(registry.getAdapter('slack')).toBe(adapter);
    });

    it('重複登録するとErrorをthrowする', () => {
      const adapter1 = createMockAdapter('slack', 'Slack1');
      const adapter2 = createMockAdapter('slack', 'Slack2');
      registry.register(adapter1);
      expect(() => registry.register(adapter2)).toThrow('Adapter already registered for source: slack');
    });

    it('最初の登録がデフォルトアダプタになる', () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);
      expect(registry.getDefaultAdapter()).toBe(slackAdapter);
    });
  });

  describe('getAdapter', () => {
    it('未登録のsourceはundefinedを返す', () => {
      expect(registry.getAdapter('github')).toBeUndefined();
    });
  });

  describe('getDefaultAdapter', () => {
    it('未登録時はundefinedを返す', () => {
      expect(registry.getDefaultAdapter()).toBeUndefined();
    });
  });

  describe('initAll', () => {
    it('全アダプタのinitが呼ばれる', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);

      expect(slackAdapter.init).toHaveBeenCalledWith(mockCallbacks);
      expect(lineAdapter.init).toHaveBeenCalledWith(mockCallbacks);
    });

    it('1つが失敗しても他は初期化される（障害隔離）', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      slackAdapter.init.mockRejectedValueOnce(new Error('init failed'));
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);

      expect(slackAdapter.init).toHaveBeenCalled();
      expect(lineAdapter.init).toHaveBeenCalledWith(mockCallbacks);
    });
  });

  describe('startAll', () => {
    it('初期化済みのみstartされる', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);
      await registry.startAll();

      expect(slackAdapter.start).toHaveBeenCalled();
      expect(lineAdapter.start).toHaveBeenCalled();
    });

    it('未初期化のアダプタはスキップされる（warn）', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      slackAdapter.init.mockRejectedValueOnce(new Error('init failed'));
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await registry.initAll(mockCallbacks);
      await registry.startAll();

      // slackは初期化失敗したのでstartされない
      expect(slackAdapter.start).not.toHaveBeenCalled();
      expect(lineAdapter.start).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping start for adapter Slack')
      );
      warnSpy.mockRestore();
    });

    it('1つが失敗しても他は起動する（障害隔離）', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);
      slackAdapter.start.mockRejectedValueOnce(new Error('start failed'));
      await registry.startAll();

      expect(slackAdapter.start).toHaveBeenCalled();
      expect(lineAdapter.start).toHaveBeenCalled();
    });
  });

  describe('stopAll', () => {
    it('全アダプタのstopが呼ばれる', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);
      await registry.startAll();
      await registry.stopAll();

      expect(slackAdapter.stop).toHaveBeenCalled();
      expect(lineAdapter.stop).toHaveBeenCalled();
    });

    it('1つが失敗しても他は停止する（障害隔離）', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);
      await registry.startAll();
      slackAdapter.stop.mockRejectedValueOnce(new Error('stop failed'));
      await registry.stopAll();

      expect(slackAdapter.stop).toHaveBeenCalled();
      expect(lineAdapter.stop).toHaveBeenCalled();
    });
  });

  describe('getActiveAdapters', () => {
    it('起動済みのみ返す', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      // 起動前は空
      expect(registry.getActiveAdapters()).toEqual([]);

      // initAll + startAll後
      await registry.initAll(mockCallbacks);
      await registry.startAll();
      const active = registry.getActiveAdapters();
      expect(active).toHaveLength(2);
      expect(active).toContain(slackAdapter);
      expect(active).toContain(lineAdapter);
    });

    it('startに失敗したアダプタはactiveに含まれない', async () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      await registry.initAll(mockCallbacks);
      slackAdapter.start.mockRejectedValueOnce(new Error('start failed'));
      await registry.startAll();

      const active = registry.getActiveAdapters();
      expect(active).toHaveLength(1);
      expect(active).toContain(lineAdapter);
      expect(active).not.toContain(slackAdapter);
    });
  });

  describe('getHealthAll', () => {
    it('全アダプタの健全性をオブジェクトで返す', () => {
      const slackAdapter = createMockAdapter('slack', 'Slack');
      const lineAdapter = createMockAdapter('line', 'LINE');
      registry.register(slackAdapter);
      registry.register(lineAdapter);

      const health = registry.getHealthAll();
      expect(health).toEqual({
        slack: { name: 'Slack', status: 'healthy' },
        line: { name: 'LINE', status: 'healthy' },
      });
      expect(slackAdapter.getHealth).toHaveBeenCalled();
      expect(lineAdapter.getHealth).toHaveBeenCalled();
    });
  });
});

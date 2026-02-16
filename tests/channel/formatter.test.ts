import { describe, it, expect } from 'vitest';
import { SplitMessage } from '../../src/channel/formatter.js';

describe('SplitMessage', () => {
  it('maxLength以内のテキストは分割なし、配列長1', () => {
    const result = SplitMessage('Hello', 10);
    expect(result).toEqual(['Hello']);
    expect(result).toHaveLength(1);
  });

  it('ちょうどmaxLengthのテキストは分割なし', () => {
    const text = 'abcde';
    const result = SplitMessage(text, 5);
    expect(result).toEqual(['abcde']);
    expect(result).toHaveLength(1);
  });

  it('空文字列は配列長1で空文字列を返す', () => {
    const result = SplitMessage('', 10);
    expect(result).toEqual(['']);
    expect(result).toHaveLength(1);
  });

  it('maxLength超のテキストが改行で自然分割される', () => {
    // maxLength=10, 改行位置が10*0.3=3より大きい位置にある
    const text = 'abcdefg\nhi jklmnop';
    const result = SplitMessage(text, 10);
    // 改行位置=7 > 10*0.3=3 なので改行で分割
    expect(result.length).toBeGreaterThan(1);
    // [N/M]プレフィックス付き
    expect(result[0]).toMatch(/^\[1\/\d+\] abcdefg\n/);
  });

  it('改行がない場合、スペースで分割される', () => {
    // スペース位置が maxLength*0.3 より大きい
    const text = 'abcd efgh ijkl mnop';
    const result = SplitMessage(text, 10);
    expect(result.length).toBeGreaterThan(1);
    // スペースで分割されている（改行なし）
    expect(result[0]).toContain('[1/');
  });

  it('改行もスペースもない場合、ハードカットで分割される', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = SplitMessage(text, 10);
    expect(result.length).toBeGreaterThan(1);
    // プレフィックス付き、ハードカットで分割
    expect(result[0]).toMatch(/^\[1\/\d+\] /);
  });

  it('改行位置がmaxLength*0.3未満の場合ハードカットにフォールバック', () => {
    // maxLength=20, 改行位置=2 < 20*0.3=6 → 改行は使われない
    // スペースもmaxLength*0.3未満の位置にしかない場合、ハードカット
    const text = 'ab\ncdefghijklmnopqrstuvwxyz0123456789';
    const result = SplitMessage(text, 20);
    expect(result.length).toBeGreaterThan(1);
    // 最初のチャンクが20文字（プレフィックス除外前）でハードカットされている
    // プレフィックス [1/N] が付く
    expect(result[0]).toMatch(/^\[1\/\d+\] /);
    // 改行位置(2)ではなくmaxLengthでカットされていることを確認
    const content = result[0].replace(/^\[\d+\/\d+\] /, '');
    expect(content.length).toBe(20);
  });

  it('2チャンク以上で [N/M] プレフィックスが付与される', () => {
    const text = 'a'.repeat(25);
    const result = SplitMessage(text, 10);
    expect(result.length).toBeGreaterThan(1);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toMatch(new RegExp(`^\\[${i + 1}/${result.length}\\] `));
    }
  });

  it('1チャンクの場合はプレフィックスが付与されない', () => {
    const result = SplitMessage('short', 100);
    expect(result).toEqual(['short']);
    expect(result[0]).not.toMatch(/^\[\d+\/\d+\]/);
  });

  it('非常に長いテキストが複数回分割される', () => {
    const text = 'a'.repeat(100);
    const result = SplitMessage(text, 10);
    // 100文字 / 10文字 = 10チャンク
    expect(result.length).toBe(10);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toMatch(new RegExp(`^\\[${i + 1}/10\\] `));
    }
  });

  it('スペースでの分割がmaxLength*0.3未満の場合ハードカットされる', () => {
    // maxLength=20, スペース位置=2 < 20*0.3=6 → ハードカット
    const text = 'ab cdefghijklmnopqrstuvwxyz0123456789';
    const result = SplitMessage(text, 20);
    expect(result.length).toBeGreaterThan(1);
    const content = result[0].replace(/^\[\d+\/\d+\] /, '');
    expect(content.length).toBe(20);
  });
});

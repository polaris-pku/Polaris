import { describe, expect, it } from 'vitest';
import { durationBetween, elapsedSince, formatElapsed } from '@/lib/elapsed';

describe('formatElapsed', () => {
  it('一分钟以内保留一位小数', () => {
    expect(formatElapsed(42_100)).toBe('42.1s');
    expect(formatElapsed(600)).toBe('0.6s');
  });

  it('超过一分钟改成分秒，秒补零成两位（主句每秒重排，宽度不能跳）', () => {
    expect(formatElapsed(72_000)).toBe('1m12s');
    expect(formatElapsed(62_000)).toBe('1m02s');
    expect(formatElapsed(60_000)).toBe('1m00s');
  });

  it('负数按 0 处理 —— 绝不给出负数秒表', () => {
    expect(formatElapsed(-5_000)).toBe('0.0s');
  });
});

describe('elapsedSince', () => {
  it('从 ISO 开始时刻算到 now', () => {
    const now = new Date('2026-01-01T00:00:42.100Z').getTime();
    expect(elapsedSince('2026-01-01T00:00:00.000Z', now)).toBe(42_100);
  });

  it('缺失 / 非法 / 未来时刻 → 0', () => {
    const now = new Date('2026-01-01T00:00:00.000Z').getTime();
    expect(elapsedSince(undefined, now)).toBe(0);
    expect(elapsedSince('不是时间', now)).toBe(0);
    expect(elapsedSince('2026-01-01T00:01:00.000Z', now)).toBe(0);
  });
});

describe('durationBetween', () => {
  it('闭合跨度的真实耗时', () => {
    expect(durationBetween('2026-01-01T00:00:00.000Z', '2026-01-01T00:01:12.000Z')).toBe(72_000);
  });

  it('任一端缺失 → 0（不猜）', () => {
    expect(durationBetween(undefined, '2026-01-01T00:01:12.000Z')).toBe(0);
    expect(durationBetween('2026-01-01T00:00:00.000Z', undefined)).toBe(0);
  });
});

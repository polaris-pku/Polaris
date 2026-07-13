import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  stopButtonLabel,
  stopButtonTitle,
  stopSignalOf,
  terminalStatusLine,
} from '@/lib/terminalExit';

const base = { exitCode: null, durationMs: 0, platform: 'linux' as NodeJS.Platform };

describe('formatDuration', () => {
  it('秒级保留一位小数，分钟级换成 m/s', () => {
    expect(formatDuration(600)).toBe('0.6s');
    expect(formatDuration(42_100)).toBe('42.1s');
    expect(formatDuration(72_000)).toBe('1m12s');
  });
});

describe('terminalStatusLine', () => {
  it('运行中：呼吸的 command 色 + 秒表', () => {
    expect(terminalStatusLine({ ...base, status: 'running', durationMs: 3200 })).toEqual({
      text: '● 运行中 · 3.2s',
      tone: 'command',
    });
  });

  it('退出码 0 → ok', () => {
    expect(terminalStatusLine({ ...base, status: 'exited', exitCode: 0, durationMs: 600 })).toEqual(
      { text: '✓ 已退出 · 代码 0 · 用时 0.6s', tone: 'ok' },
    );
  });

  it('非零退出 → danger（失败必须看起来像失败）', () => {
    expect(terminalStatusLine({ ...base, status: 'exited', exitCode: 1, durationMs: 400 })).toEqual(
      { text: '✕ 已退出 · 代码 1 · 用时 0.4s', tone: 'danger' },
    );
  });

  it('输出截断 → human 色，明说保留了多少', () => {
    expect(terminalStatusLine({ ...base, status: 'running', truncated: true })).toEqual({
      text: '⚠ 输出过多，已截断（保留最后 2000 行）',
      tone: 'human',
    });
  });

  it('截断过的会话跑完后，退出码仍然要说出来', () => {
    expect(
      terminalStatusLine({
        ...base,
        status: 'exited',
        exitCode: 0,
        durationMs: 600,
        truncated: true,
      }),
    ).toEqual({ text: '✓ 已退出 · 代码 0 · 用时 0.6s · 输出已截断', tone: 'ok' });
  });

  it('启动失败 → danger，并如实带上主进程给的原因', () => {
    expect(
      terminalStatusLine({ ...base, status: 'error', errorMessage: '未知的 Python 运行时' }),
    ).toEqual({ text: '✕ 启动失败 · 未知的 Python 运行时', tone: 'danger' });
  });

  // ── 平台分支：不假装两个平台一致（I11）──
  it('POSIX 被停止 → 「已中断」（发的是真 SIGINT，python 会打出 KeyboardInterrupt）', () => {
    expect(
      terminalStatusLine({
        ...base,
        status: 'killed',
        durationMs: 8000,
        platform: 'linux',
      }),
    ).toEqual({ text: '● 已中断 · 用时 8.0s', tone: 'muted' });
  });

  it('Windows 被停止 → 「已终止」（那里根本没有中断信号）', () => {
    expect(
      terminalStatusLine({
        ...base,
        status: 'killed',
        durationMs: 8000,
        platform: 'win32',
      }),
    ).toEqual({ text: '■ 已终止 · 用时 8.0s', tone: 'muted' });
  });
});

describe('停止按钮的诚实文案', () => {
  it('POSIX 叫「中断」，Windows 叫「停止」', () => {
    expect(stopButtonLabel('darwin')).toBe('中断');
    expect(stopButtonLabel('win32')).toBe('停止');
  });

  it('Windows 的 tooltip 必须把「没有真中断信号」说出来', () => {
    expect(stopButtonTitle('win32')).toContain('没有真正的中断信号');
    expect(stopButtonTitle('linux')).toContain('KeyboardInterrupt');
  });

  it('Windows 上「停止」发的就是 kill —— 不伪装成 interrupt', () => {
    expect(stopSignalOf('win32')).toBe('kill');
    expect(stopSignalOf('linux')).toBe('interrupt');
  });
});

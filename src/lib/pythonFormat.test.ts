import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDownloadProgress,
  installPhaseLabel,
  runtimeLabel,
  runtimeShortLabel,
  uninstallConfirmText,
  NO_RUNTIME_TEXT,
  PLATFORM_UNAVAILABLE_TEXT,
} from './pythonFormat';

const MB = 1024 * 1024;

describe('formatBytes', () => {
  it('100 MB 以下保留 1 位小数 —— 0.1 MB 的跳动就是「它还在动」的证据', () => {
    expect(formatBytes(28 * MB)).toBe('28.0 MB');
    expect(formatBytes(12.4 * MB)).toBe('12.4 MB');
  });

  it('100 MB 以上取整 —— 没人关心安装包是 248.3 还是 248.4', () => {
    expect(formatBytes(248 * MB)).toBe('248 MB');
  });

  it('小量级降级到 KB / B，不硬凑成 0.0 MB', () => {
    expect(formatBytes(890 * 1024)).toBe('890 KB');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('负数 / NaN 不产出 NaN MB', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatDownloadProgress', () => {
  it('同单位时只写一次单位', () => {
    expect(formatDownloadProgress(12.4 * MB, 28 * MB)).toBe('12.4 / 28.0 MB');
  });

  it('单位不同就各写各的 —— 不把 890 KB 硬说成 0.9 MB', () => {
    expect(formatDownloadProgress(890 * 1024, 28 * MB)).toBe('890 KB / 28.0 MB');
  });

  it('总量未知时只报已下载量，不编一个分母出来', () => {
    expect(formatDownloadProgress(3 * MB, 0)).toBe('3.0 MB');
  });
});

describe('installPhaseLabel', () => {
  it('每一相都有名字 —— 卡住时用户要知道卡在下载还是解包', () => {
    expect(
      installPhaseLabel({
        catalogId: 'cpython-3.13.14',
        phase: 'download',
        percent: 44,
        receivedBytes: 12.4 * MB,
        totalBytes: 28 * MB,
      }),
    ).toBe('下载 12.4 / 28.0 MB');

    expect(installPhaseLabel({ catalogId: 'cpython-3.13.14', phase: 'verify', percent: 0 })).toBe(
      '校验 · SHA-256',
    );

    expect(
      installPhaseLabel({
        catalogId: 'cpython-3.13.14',
        phase: 'extract',
        percent: 31,
        entries: 1204,
      }),
    ).toBe('解包 · 1,204 个文件 · 31%');

    expect(installPhaseLabel({ catalogId: 'cpython-3.13.14', phase: 'done', percent: 100 })).toBe(
      '● 已就绪',
    );
  });

  it('校验失败的原文必须原样透出来 —— 它可能真的是中间人，不能被润色成「网络错误」', () => {
    expect(
      installPhaseLabel({
        catalogId: 'cpython-3.13.14',
        phase: 'error',
        percent: 0,
        message: '校验失败 · 文件可能被篡改或下载不完整',
      }),
    ).toBe('校验失败 · 文件可能被篡改或下载不完整');
  });

  it('error 没带 message 也不能是空白', () => {
    expect(installPhaseLabel({ catalogId: 'x', phase: 'error', percent: 0 })).toBe('安装失败');
  });
});

describe('运行时文案', () => {
  const managed: PyRuntime = {
    id: 'managed:cpython-3.13.14',
    version: '3.13.14',
    source: 'managed',
    displayPath: '/home/u/.config/Polaris/runtimes/python/cpython-3.13.14/python/bin/python3',
    sizeBytes: 248 * MB,
    removable: true,
  };

  it('带来源 —— 用户要能分清「这是你装的」还是「这是我系统里的」', () => {
    expect(runtimeLabel(managed)).toBe('Python 3.13.14 · Polaris 托管');
    expect(runtimeLabel({ ...managed, source: 'system', removable: false })).toBe(
      'Python 3.13.14 · 系统安装',
    );
    expect(runtimeLabel({ ...managed, source: 'manual', removable: false })).toBe(
      'Python 3.13.14 · 手动指定',
    );
  });

  it('没有解释器是一等状态，不是空字符串', () => {
    expect(runtimeShortLabel(null)).toBe('未装 Python');
    expect(runtimeShortLabel(managed)).toBe('Python 3.13.14');
    expect(NO_RUNTIME_TEXT).toContain('未检测到');
  });

  it('平台没有资产也是一等状态，且给出唯一的出路', () => {
    expect(PLATFORM_UNAVAILABLE_TEXT).toContain('手动指定');
  });

  it('卸载确认用实测占用，且如实说会话不会被自动停掉', () => {
    expect(uninstallConfirmText(managed)).toBe(
      '删除 Python 3.13.14？将释放 248 MB。正在用它运行的终端会话需要先关闭。',
    );
  });

  it('没量到体积就不编一个数字出来', () => {
    expect(uninstallConfirmText({ ...managed, sizeBytes: undefined })).toBe(
      '删除 Python 3.13.14？正在用它运行的终端会话需要先关闭。',
    );
  });
});

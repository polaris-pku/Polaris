// 用户设置（userData/settings.json）的唯一读写入口。
//
// 这个模块是从 backendBridge.cjs 里抽出来的，**同时是一个 bug 修复**：
// 原实现是「readSettings() → 整个对象 writeFileSync 覆写」，既不串行也不原子。
//   · 不串行：用户在设置弹窗里存 API key 的同一秒，一个 Python 安装完成回写 python.*，
//     两边各自读到同一份旧快照再全量覆写 —— 后写的那次会**静默吃掉**先写的改动（API key 没了）。
//   · 不原子：writeFileSync 直接就地截断目标文件，崩在写一半 → 半截 JSON；
//     而 readSettings 的 catch-all 会把半截 JSON 当成 {} —— 用户的 key 无声消失。
//
// 修复：
//   · 串行队列（chain）—— 所有写入排队，读-改-写在队列里是原子的一步；
//   · tmp + renameSync —— rename 在同一文件系统内是原子的，读者要么看到旧文件要么看到新文件，
//     永远看不到半截；
//   · 保持 mode 0o600（文件里有明文 API key）。
//
// 合并语义 { ...current, ...patch } 与原实现一致：**顶层未知键会被保留**，
// 所以新增一个顶层 `python` 块（Python 运行时选择）不会破坏既有的 provider/providers。
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/** settings.json 的绝对路径（userData 跨版本更新存活，且不进仓库、不进安装目录）。 */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * 读设置。**永不抛**：文件不存在 / 坏 JSON / 不是对象 → 一律 {}。
 * 这个 catch-all 同时是自动更新的向后兼容层（旧版本写的未知键会被 spread 保留），别破坏它。
 */
function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** 写入串行队列：保证「读-改-写」不会被另一个写入穿插。永不因单次失败而断链。 */
let chain = Promise.resolve();
/** tmp 文件名去重计数（同毫秒内的并发写不能撞同一个 tmp）。 */
let tmpSeq = 0;

/** 一次原子写：写 tmp → rename 覆盖。返回合并后的完整设置对象。 */
function writeNow(patch) {
  const current = readSettings();
  const merged = { ...current, ...(patch ?? {}) };

  const file = settingsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  // tmp 必须与目标同目录 —— 跨文件系统的 rename 不是原子的（会退化成 copy+unlink）
  const tmp = path.join(dir, `.settings.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(tmp, file); // 原子上架：读者要么看到旧文件，要么看到新文件
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // tmp 清理失败无害，别掩盖真正的错误
    }
    throw err;
  }
  try {
    fs.chmodSync(file, 0o600); // 文件里有明文 API key
  } catch {
    // 某些文件系统（如 Windows 上的部分挂载点）不支持 chmod，忽略
  }
  return merged;
}

/**
 * 写设置（合并语义 { ...current, ...patch }，顶层未知键保留）。
 * 串行 + 原子。返回合并后的完整设置对象。
 */
function writeSettings(patch) {
  const next = chain.then(() => writeNow(patch));
  // 单次失败不能毒死队列：链上只保留「已结束」这一个事实
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

module.exports = { settingsPath, readSettings, writeSettings };

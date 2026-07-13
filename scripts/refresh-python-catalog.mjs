#!/usr/bin/env node
/**
 * 生成 electron/python-catalog.json —— **构建期人工触发**，绝不在运行时跑。
 *
 *   node scripts/refresh-python-catalog.mjs            # 用 pinned tag（见下方 PINNED_TAG）
 *   node scripts/refresh-python-catalog.mjs --tag latest
 *
 * ── 为什么校验和必须在这里定死、随代码提交（不变量 I8 的核心）──
 * 一个能在下载时替换掉 tar.gz 的中间人，**同样能替换掉同一次请求里返回的校验和**。
 * 运行时现拉校验和 = 自己给自己发证书，等于没校验。sha256 只有硬编码进仓库、
 * 跟着签名后的应用一起分发，才真的能证明「你下到的这个包，就是我们发布时验过的那个包」。
 *
 * ── 数据来源的两个坑（本机实测，别凭记忆改）──
 * 1. release 里**没有 .sha256 附带文件**（实测该 tag 下 853 个 asset 无一命中）。
 *    校验和只能从 GitHub API 的 asset 对象读 `digest` 字段，格式是 "sha256:<64hex>"。
 * 2. 资产名里的 `+` 在 URL 里必须写成 %2B —— 但**这里只存文件名**，
 *    转义留给 pythonBridge 的 encodeURIComponent（存两份规则必然漂移）。
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'electron', 'python-catalog.json');

/** 钉死的 release tag。升级 Python 时改这一行，重跑本脚本，提交 diff。 */
const PINNED_TAG = '20260623';

/** 我们分发的两个 minor（同一个 tag 下每个 minor 只有一个 patch 版本）。 */
const MINORS = ['3.13', '3.12'];
/** 默认推荐给用户的那一个。 */
const RECOMMENDED_MINOR = '3.13';

/**
 * 支持的平台三元组。key 与 pythonBridge.cjs 的 TRIPLES 表一一对应 ——
 * 这里少一个，那个平台的用户就会看到「此平台暂无可一键安装的运行时」（一等状态，不是静默失败）。
 */
const TRIPLES = [
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
];

/** install_only 变体：解开即用、自带 pip、无需构建。 */
const SUFFIX = '-install_only.tar.gz';

/**
 * 解包后的近似体积倍率。
 * GitHub API 只给压缩包的 size，解包后多大它不知道 —— 所以这是个**估算**，
 * UI 上必须说「约」。真实占用在装完后由 pythonBridge 直接量目录（PyRuntime.sizeBytes），
 * 卸载确认里用的是那个**实测值**，不是这个估算值。
 */
const INSTALLED_RATIO = 2.8;

const tagArgIndex = process.argv.indexOf('--tag');
const wanted = tagArgIndex >= 0 ? process.argv[tagArgIndex + 1] : PINNED_TAG;

const api =
  wanted === 'latest'
    ? 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest'
    : `https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/${wanted}`;

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'polaris-catalog-refresh' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

console.log(`拉取 release：${api}`);
const res = await fetch(api, { headers });
if (!res.ok) {
  console.error(`GitHub API ${String(res.status)} ${res.statusText}`);
  console.error('（未认证的 API 限流是 60 次/小时；设 GITHUB_TOKEN 可提到 5000 次/小时）');
  process.exit(1);
}
const release = await res.json();
const tag = release.tag_name;
const assets = release.assets ?? [];
console.log(`tag=${tag}，assets=${String(assets.length)}`);

/** "sha256:<64hex>" → "<64hex>"。拿不到 digest 就是硬错误 —— 绝不写一个占位的 0 进 catalog。 */
function digestOf(asset) {
  const raw = String(asset.digest ?? '');
  const hex = raw.startsWith('sha256:') ? raw.slice(7) : '';
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asset ${asset.name} 没有可用的 sha256 digest（拿到：${raw || '(空)'}）`);
  }
  return hex;
}

/** 该 minor 在这个 release 里的实际 patch 版本（每个 minor 只有一个）。 */
function resolveVersion(minor) {
  const re = new RegExp(`^cpython-(${minor.replace('.', '\\.')}\\.\\d+)\\+${tag}-`);
  const versions = new Set();
  for (const a of assets) {
    const m = re.exec(a.name);
    if (m) versions.add(m[1]);
  }
  if (versions.size === 0) throw new Error(`release ${tag} 里没有 ${minor}.x`);
  if (versions.size > 1) {
    throw new Error(`release ${tag} 里 ${minor} 有多个 patch 版本：${[...versions].join(', ')}`);
  }
  return [...versions][0];
}

const items = [];
for (const minor of MINORS) {
  const version = resolveVersion(minor);
  const catalogId = `cpython-${version}`;
  const platformAssets = {};

  for (const triple of TRIPLES) {
    const file = `cpython-${version}+${tag}-${triple}${SUFFIX}`;
    const asset = assets.find((a) => a.name === file);
    if (!asset) {
      console.warn(`  · 缺 asset：${file}（该平台将显示「暂无可一键安装的运行时」）`);
      continue;
    }
    // 体积按**平台**存：同一个版本各平台差出几十 MB，存一个 item 级数字就等于
    // 对其余 5 个平台的用户撒谎（「约 28 MB」是用户决定要不要点安装的唯一依据）。
    platformAssets[triple] = {
      file,
      sha256: digestOf(asset),
      downloadBytes: asset.size,
      installedBytes: Math.round(asset.size * INSTALLED_RATIO),
    };
  }

  if (Object.keys(platformAssets).length === 0)
    throw new Error(`${catalogId} 一个平台的资产都没有`);

  items.push({ catalogId, version, assets: platformAssets });
  const sizes = Object.values(platformAssets).map((a) => a.downloadBytes / 1024 / 1024);
  console.log(
    `  ✓ ${catalogId}（${String(sizes.length)} 个平台，${Math.min(...sizes).toFixed(1)}–${Math.max(...sizes).toFixed(1)} MB）`,
  );
}

const recommendedVersion = resolveVersion(RECOMMENDED_MINOR);
const catalog = { tag, recommended: `cpython-${recommendedVersion}`, items };

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`\n已写入 ${path.relative(REPO, OUT)}`);
console.log(
  '⚠️ 版本号变了的话，src/docs/python-terminal.md 必须同步 —— docs.test.ts 会强制这一条。',
);

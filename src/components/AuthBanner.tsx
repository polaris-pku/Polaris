import { useEffect, useState } from 'react';
import { KeyRound, ArrowRight } from 'lucide-react';
import { onBackendStatus } from '@/api/events';
import type { BackendStatus } from '@/api/transport';

/**
 * 未配置认证时的全局提示条。
 *
 * 这是装完应用后最要命的体验缺口：用户**不知道自己需要什么 token**。
 * 没有它的话，流程是：提交需求 → agent 起不来 → 界面显示一个语焉不详的失败 → 用户放弃。
 *
 * 所以在他提交之前就说清楚：缺什么、点哪里配。
 * 认证就绪（填了 key 或本机已有登录态）时整条消失，不占地方。
 */
export function AuthBanner({ onConfigure }: { onConfigure: () => void }) {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  useEffect(() => onBackendStatus(setStatus), []);

  // 浏览器（无桌面桥）走 mock 剧本，本来就不需要认证 —— 不提示
  if (!window.desktop?.backend) return null;
  // 后端还没起来时不提示（认证状态可能还没读到，避免闪一下又消失）
  if (!status || status.state === 'stopped') return null;
  if (status.auth.ready) return null;

  const providerName =
    status.providers.find((p) => p.id === status.auth.providerId)?.name ?? '模型服务商';

  // 填了 key 但端点/模型没填全 —— 这种「配了一半」如果只说「未配置」，用户会以为自己填过了
  const { incomplete } = status.auth;

  return (
    <button
      type="button"
      onClick={onConfigure}
      className="group flex w-full items-center gap-2.5 border-b border-human/30 bg-human/10 px-5 py-2 text-left transition-colors hover:bg-human/15"
    >
      <KeyRound className="h-4 w-4 shrink-0 text-human-soft" />
      <span className="min-w-0 text-xs text-human-soft">
        <strong className="font-semibold">
          {incomplete
            ? `${providerName} 的配置不完整：还缺端点或模型名`
            : '还差一步：配置模型服务商与 API key'}
        </strong>
        <span className="ml-2 text-human-soft/70">
          Coding agent 已随应用安装，无需另外安装；配好之后 agent 才能真正干活。
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-human/40 bg-human/15 px-2.5 py-1 text-[11px] font-medium text-human-soft group-hover:border-human/60">
        去配置 <ArrowRight className="h-3 w-3" />
      </span>
    </button>
  );
}

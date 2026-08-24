import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { artifactApi } from '@/api/artifact';
import { BackendError } from '@/api/transport';
import {
  ARTIFACT_CONTENT_UNAVAILABLE_CODE,
  ARTIFACT_NOT_FOUND_CODE,
  type ArtifactContentResult,
} from '@/api/types/artifact';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IdChip } from '@/components/ui/IdChip';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import { formatBytes } from '@/lib/pythonFormat';

/**
 * 产物正文查看器 —— 把一个 artifact_id 换成能读的正文。
 *
 * 在此之前产物引用在界面上是一排死 ID：能看见、能复制，就是打不开。这里补上那一步。
 *
 * 两条诚实性约束（都来自后端契约，不是审美选择）：
 *  1. **截断必须说出来。** 单次响应上限 1 MiB，后端没有分页通道 —— 重新打开读到的还是
 *     同一段。装作读全了，用户就会拿半份内容下判断。
 *  2. **摘要对不上也要说出来。** `sha256` 算的是完整字节；正文被截断时它与下方内容不一致，
 *     不能拿它去校验看到的这一段。
 *
 * 本弹窗没有任何「送回后端」的动作 —— 后端只提供读取，界面就只读。
 */

/** JSON-RPC 标准码：后端没注册 artifact.getContent（版本过旧）时回这个。 */
const METHOD_NOT_FOUND_CODE = -32601;

/**
 * 产物类型的人话。后端这个字段声明的是裸 string（不是收紧的联合），
 * 所以这里只做翻译、不做穷尽匹配：认不出来就原样显示，不编造。
 */
const TYPE_LABEL: Record<string, string> = {
  patch: '补丁',
  diff: '代码差异',
  test_log: '测试日志',
  review: '评审记录',
  decision_packet: '决议包',
  checkpoint: '检查点',
  context: '上下文包',
  transcript: '对话记录',
  driver_result: '执行器结果',
  audit: '审计记录',
  merge_authorization: '合入授权',
};

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type ArtifactLoadError = {
  /** 一句话说清发生了什么 */
  title: string;
  /** 下一步能做什么 / 诊断信息；没有就不显示 */
  hint?: string;
  /** 后端原始错误码，始终保留（灰色注解，排查时要用） */
  code?: string;
};

/**
 * 后端错误 → 人话。未知错误码不编造解释，原样透出 message（同 lib/backendErrors 的口径）。
 *
 * 注意 `BackendError.code` 是 JSON-RPC 的**数字**码，不是字符串枚举。
 */
function explainArtifactError(reason: unknown): ArtifactLoadError {
  const raw = reason instanceof Error ? reason.message : String(reason);
  if (!(reason instanceof BackendError)) return { title: raw };

  const code = typeof reason.code === 'number' ? String(reason.code) : undefined;
  switch (reason.code) {
    case ARTIFACT_NOT_FOUND_CODE:
      return {
        title: '找不到这个产物',
        hint: '这个运行的阶段状态里没有该产物：可能运行记录已被清理，也可能这条引用属于另一次运行。后端在协议层区分不了这两种情况。',
        code,
      };
    case ARTIFACT_CONTENT_UNAVAILABLE_CODE: {
      // reason 是后端异常的自由文本，只能当诊断信息原样展示，不做分支判断。
      const detail = str(asRecord(reason.data).reason);
      return {
        title: '产物存在，但正文读不出来',
        hint: detail || '后端只登记了这条产物的元数据，没有可读正文。',
        code,
      };
    }
    case METHOD_NOT_FOUND_CODE:
      return {
        title: '当前后端还不提供产物正文读取',
        hint: '后端版本过旧。更新后端后重新打开即可。',
        code,
      };
    default:
      return { title: raw, code };
  }
}

/**
 * 产物正文弹窗。`artifactId` 非 null 即打开 —— 开关状态由父组件持有（CouncilBoard），
 * 本组件只负责读取与呈现。
 */
export function ArtifactContentDialog({
  runId,
  artifactId,
  onClose,
}: {
  runId: string;
  artifactId: string | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<ArtifactContentResult>();
  const [error, setError] = useState<ArtifactLoadError>();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!artifactId) {
      setContent(undefined);
      setError(undefined);
      return;
    }
    let active = true;
    setContent(undefined);
    setError(undefined);
    setCopied(false);
    setLoading(true);
    void artifactApi
      .getContent(runId, artifactId)
      .then((result) => {
        if (active) setContent(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(explainArtifactError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runId, artifactId]);

  const copyContent = useCallback(() => {
    if (!content) return;
    void navigator.clipboard?.writeText(content.content).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  }, [content]);

  return (
    <Dialog open={artifactId !== null} onClose={onClose} className="max-w-3xl">
      <div className="flex max-h-[85vh] flex-col p-6">
        <div className="flex items-center gap-2 pr-8">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-panel border border-command/20 bg-command/10 text-command-soft">
            <FileText className="h-5 w-5" />
          </div>
          <h2 className="text-title text-fg-primary">产物正文</h2>
          {artifactId && <IdChip value={artifactId} label="产物 ID" />}
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在读取产物正文…
          </div>
        )}

        {error && !loading && (
          <div className="mt-4 flex items-start gap-2 rounded-panel border border-danger/30 bg-danger/10 px-3 py-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-danger-soft" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-2 text-body text-danger-soft">
                {error.title}
                {error.code && (
                  <span className="tabular font-mono text-code text-fg-faint">{error.code}</span>
                )}
              </p>
              {error.hint && <p className="mt-1 text-body text-fg-muted">{error.hint}</p>}
            </div>
          </div>
        )}

        {content && !loading && (
          <>
            <div className="mt-4">
              <KeyValueList>
                <KeyValue
                  k="类型"
                  v={
                    TYPE_LABEL[content.type]
                      ? `${TYPE_LABEL[content.type]}（${content.type}）`
                      : content.type
                  }
                />
                <KeyValue k="媒体类型" v={content.media_type} mono />
                {content.target_path && (
                  <KeyValue k="目标路径" v={content.target_path} mono copyable />
                )}
                <IdRow k="摘要" value={content.sha256} />
                <KeyValue
                  k="大小"
                  v={`${formatBytes(content.bytes_total)}（${content.bytes_total.toLocaleString('en-US')} 字节）`}
                  mono
                />
              </KeyValueList>
            </div>

            {content.truncated && (
              <div className="mt-3 flex items-start gap-2 rounded-panel border border-human/30 bg-human/10 px-3 py-2">
                <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-human-soft" />
                <div className="min-w-0">
                  <p className="text-body text-human-soft">
                    正文已截断，下方只是开头的 1 MiB。完整内容共 {formatBytes(content.bytes_total)}
                    （<span className="tabular">{content.bytes_total.toLocaleString('en-US')}</span>{' '}
                    字节）。
                  </p>
                  <p className="mt-1 text-body text-fg-muted">
                    后端没有分页通道，重新打开读到的还是同一段；上方摘要算的是完整字节，与这里显示的内容对不上，别拿它校验。截断是按字节切的，最后一个字符可能是乱码。
                  </p>
                </div>
              </div>
            )}

            {content.content ? (
              <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-panel border border-edge bg-surface-void p-3 font-mono text-code text-fg-secondary">
                {content.content}
              </pre>
            ) : (
              <p className="mt-3 rounded-panel border border-edge bg-surface-void px-3 py-4 text-body text-fg-muted">
                后端返回的正文为空。
              </p>
            )}
          </>
        )}

        <div className="mt-6 flex shrink-0 justify-end gap-2">
          {content && (
            <Button variant="ghost" onClick={copyContent}>
              {copied ? '已复制' : '复制正文'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** KeyValue 的同款栅格，值换成可复制的 IdChip（机器 ID 不裸奔）。 */
function IdRow({ k, value }: { k: string; value: string }): ReactNode {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-20 shrink-0 text-body text-fg-muted">{k}</span>
      <IdChip value={value} />
    </div>
  );
}

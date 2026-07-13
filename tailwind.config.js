/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // fontFamily.display 已删除 —— 那个拉丁几何体没有任何中文字形，而且它的 CDN 字体
        // @import 在打包版（file:// + 离线）里根本没生效过：它在已发布的安装包里从来没渲染过。
        // 技术感改由等宽 tabular 数字 + .callsign 眉标 + 终端 + 暗色网格承载，这更耐用。
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // 行高焊进元组；禁止裸 leading-*；禁止 text-[Npx]。
        // 字重全应用只有 400 / 700：micro 与 headline 是仅有的两处 700。
        micro: ['10px', { lineHeight: '14px', letterSpacing: '0.08em', fontWeight: '700' }],
        meta: ['11px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        body: ['13px', { lineHeight: '22px' }],
        title: ['15px', { lineHeight: '24px' }],
        headline: ['24px', { lineHeight: '34px', letterSpacing: '-0.01em', fontWeight: '700' }],
        code: ['12px', { lineHeight: '20px' }],
      },
      colors: {
        surface: {
          void: '#090b10',
          deck: '#0e121a',
          panel: '#121724',
          raised: '#19202e',
        },
        edge: { DEFAULT: '#1e2636', strong: '#2a3346' },
        fg: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#64748b',
          faint: '#475569',
        },
        // 强调色只有 4 个，且只编码状态：机器在动 / 需要你 / 成功 / 失败
        command: { DEFAULT: '#4d8df0', soft: '#6fa3f4', deep: '#2f6fd6' },
        human: { DEFAULT: '#ffb454', soft: '#ffc880', deep: '#e8932c' },
        ok: { DEFAULT: '#34d399', soft: '#6ee7b7', deep: '#059669' },
        danger: { DEFAULT: '#fb7185', soft: '#fda4af', deep: '#e11d48' },
        // ink / line 迁移垫片已删除（迁移完成，全仓零引用）。
        //
        // 它们是没法靠 typecheck 兜住的一类东西：Tailwind 遇到不认识的类名不会报错，
        // 只是**不生成那条 CSS** —— 留着垫片，一个漏改的 bg-ink-900 会一直正常显示，
        // 删掉垫片，它会安静地变成「没有背景色」。所以这一刀必须在迁移真正清零之后砍，
        // 而不是靠「以后记得删」。
      },
      borderRadius: { chip: '4px', panel: '8px', modal: '12px' },
      // 元素级 box-shadow 全灭。唯一还会发光的东西是 .led 的 filter 光晕（index.css）。
      boxShadow: { modal: '0 24px 64px -32px rgba(0,0,0,0.9)' },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        blink: {
          '0%, 45%': { opacity: '1' },
          '55%, 100%': { opacity: '0.25' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'pulse-ring': 'pulse-ring 1.6s ease-in-out infinite',
        blink: 'blink 1.4s steps(1, end) infinite',
      },
    },
  },
  plugins: [],
};

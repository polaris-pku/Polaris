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
        brand: {
          void: '#000000',
          deep: '#0A1B3F',
          purple: '#7717FF',
          silver: '#C0C0C3',
          panel: '#1A1A1C',
          border: '#2a2a2e',
        },
        surface: {
          void: '#000000',
          deck: '#0A1B3F',
          panel: '#1A1A1C',
          raised: '#222226',
        },
        edge: { DEFAULT: '#1f1f23', strong: '#2a2a2e' },
        fg: {
          primary: '#C0C0C3',
          secondary: '#9a9aa0',
          muted: '#6b6b72',
          faint: '#4a4a52',
        },
        // command 取值改为品牌紫；human 仍是「需要你」语义色，全仓状态机仍依赖它。
        command: { DEFAULT: '#7717FF', soft: '#9a5dff', deep: '#5c11c4' },
        human: { DEFAULT: '#ffb454', soft: '#ffc880', deep: '#e8932c' },
        ok: { DEFAULT: '#34d399', soft: '#6ee7b7', deep: '#059669' },
        danger: { DEFAULT: '#fb7185', soft: '#fda4af', deep: '#e11d48' },
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

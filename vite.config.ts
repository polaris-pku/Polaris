import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// base 用相对路径：打包后 Electron 以 file:// 加载 dist/index.html 才能解析资源
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // 根仓只测前端（src/）。packages/ 下的 A、BCD 各有自己的测试命令，且它们的
  // fixture 路径是 cwd 相对的 —— 从根仓跑必然找不到文件。用 pnpm -r test 跑全量。
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        // 按依赖体量拆 vendor chunk：画布/图标/其余三方库独立缓存，也消除 500kB 大包警告
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@xyflow') || /node_modules\/d3-/.test(id)) return 'vendor-flow';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return 'vendor';
        },
      },
    },
  },
}));

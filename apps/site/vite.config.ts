import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [viteReact()],
  server: { host: '127.0.0.1', port: 1422, strictPort: true },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Pages: the dashboard (home) and the display kit. The old 3D game lives in experiments/game.
      input: {
        main: 'index.html',
        displays: 'displays.html',
      },
    },
  },
})

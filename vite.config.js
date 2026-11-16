import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Pages: the dashboard (home), ORBIT v2 (the dashboard with the team's Figma ideas), the scrolling story
      // (the dashboard worn on a wrist) and the display kit. The old 3D game lives in experiments/game.
      input: {
        main: 'index.html',
        displays: 'displays.html',
        orbit: 'orbit.html',
        story: 'story.html',
      },
    },
  },
})


import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: '/',
    define: {
        // Fix ReferenceError: Global constants expected by the app
        __APP_VERSION__: JSON.stringify('1.3.6'),
        __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
    server: {
        port: 5173,
        host: true
    }
})

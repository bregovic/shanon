
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: '/',
    define: {
        // Fix ReferenceError: __APP_VERSION__ is not defined
        __APP_VERSION__: JSON.stringify('1.3.1'),
    },
    server: {
        port: 5173,
        host: true
    }
})

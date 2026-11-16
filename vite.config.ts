import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({plugins: [react()], base: './', define: {__GLUCODEL_SERVER__: 'false'}})

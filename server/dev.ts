import {mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {createServer} from 'vite'
import {createApi} from './api.ts'

const directory = resolve('.glucodel')
mkdirSync(directory, {recursive: true})
const api = createApi(resolve(directory, 'workspace.sqlite'))
await new Promise<void>((done, reject) => {
  api.once('error', reject)
  api.listen(0, '127.0.0.1', done)
})
const address = api.address()
if (!address || typeof address === 'string') throw new Error('Local API did not bind to a loopback TCP port')

try {
  const vite = await createServer({
    mode: 'local-api',
    server: {
      host: '127.0.0.1',
      fs: {deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.glucodel/**']},
      proxy: {'/api': {target: 'http://127.0.0.1:' + address.port, changeOrigin: false}},
    },
    define: {__GLUCODEL_SERVER__: 'true'},
  })
  await vite.listen()
  vite.printUrls()
  const close = async () => {
    await vite.close()
    api.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
} catch (error) {
  api.close()
  throw error
}

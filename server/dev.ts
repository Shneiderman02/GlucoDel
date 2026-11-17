import {existsSync, mkdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createServer} from 'vite'
import {createApi} from './api.ts'
import {createNightscout, readNightscoutConfig} from './nightscout.ts'
import type {Workspace} from '../src/workspace.ts'

const directory = resolve('.glucodel')
mkdirSync(directory, {recursive: true})
const config = readNightscoutConfig(process.env)
const seed = resolve(directory, 'azt1d.json')
const study = existsSync(seed) ? JSON.parse(readFileSync(seed, 'utf8')) as Workspace : undefined
const api = createApi(resolve(directory, 'workspace.sqlite'), config && createNightscout(config), undefined, study)
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
  console.log('  AZT1D: добавьте ?workspace=study#/history к локальному адресу')
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

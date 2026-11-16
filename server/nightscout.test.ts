import assert from 'node:assert/strict'
import {createServer, type Server} from 'node:http'
import {test} from 'node:test'
import {createApi} from './api.ts'
import {createNightscout, readNightscoutConfig} from './nightscout.ts'
import {actualTotal, insulinText} from '../src/model.ts'
import type {Workspace} from '../src/workspace.ts'

const token = 'fixture-read-only'
const fromBeforeFirstSync = Date.now() - 60_000

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)})
  const address = server.address()
  assert(address && typeof address === 'object')
  return 'http://127.0.0.1:' + address.port
}
function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

test('HTTPS credentials stay server-side and remote sync updates the local archive without duplicates', async () => {
  assert.equal(readNightscoutConfig({}), undefined)
  assert.throws(() => readNightscoutConfig({NIGHTSCOUT_URL: 'http://example.invalid', NIGHTSCOUT_READ_TOKEN: token}), /HTTPS/)
  assert.throws(() => readNightscoutConfig({NIGHTSCOUT_URL: 'https://example.invalid/?token=secret', NIGHTSCOUT_READ_TOKEN: token}), /не содержать/)
  const config = readNightscoutConfig({NIGHTSCOUT_URL: 'https://nightscout.example.invalid', NIGHTSCOUT_READ_TOKEN: token})!
  let authorized = true
  let requests = 0
  let protocolError = ''
  let offset = 0
  const remote = createServer((req, res) => {
    requests++
    const url = new URL(req.url!, 'http://127.0.0.1')
    if (req.method !== 'GET' || url.searchParams.get('token') !== token) protocolError = 'Unexpected method or credential'
    if (!authorized) {
      res.writeHead(403).end()
      return
    }
    const entries = url.pathname === '/api/v1/entries.json'
    if (!entries && url.pathname !== '/api/v1/treatments.json') protocolError = 'Unexpected route'
    const field = entries ? 'date' : 'created_at'
    const parse = (text: string) => entries ? Number(text) : Date.parse(text)
    const start = parse(url.searchParams.get('find[' + field + '][$gte]') ?? '')
    const end = parse(url.searchParams.get('find[' + field + '][$lt]') ?? '')
    if (!Number.isFinite(start) || !Number.isFinite(end)) protocolError = 'Unbounded request'
    const at = fromBeforeFirstSync
    const rows = at < start || at >= end ? [] : entries ? [
      {date: at, type: 'sgv', sgv: 144 + offset},
      {date: at, type: 'mbg', mbg: 120},
    ] : [
      {_id: 'dose', created_at: new Date(at).toISOString(), eventType: 'Meal Bolus', insulin: 2.3},
      {_id: 'invalid-dose', created_at: new Date(at).toISOString(), eventType: 'Meal Bolus', insulin: 10, isValid: false},
      {_id: 'note', created_at: new Date(at).toISOString(), eventType: 'Note', insulin: 13},
    ]
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(rows))
  })
  const testTransport = await listen(remote)
  const connector = createNightscout(config, (url, init) => {
    assert.equal(init?.redirect, 'error')
    const target = new URL(String(url))
    assert.equal(target.protocol, 'https:')
    return fetch(testTransport + target.pathname + target.search, init)
  })
  const api = createApi(':memory:', connector, 0)
  try {
    const base = await listen(api)
    const endpoint = () => fetch(base + '/api/archive/nightscout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})
    const read = async (res: Response) => {
      const text = await res.text()
      assert(!text.includes(token))
      assert(!text.includes(config.base.hostname))
      return JSON.parse(text) as {workspace: Workspace; message?: string}
    }
    const initial = await read(await fetch(base + '/api/archive'))
    assert.equal(initial.workspace.nightscout?.lastSuccess, undefined)

    const results = await Promise.all([endpoint(), endpoint()])
    const [first, same] = await Promise.all(results.map(read))
    assert.equal(protocolError, '')
    assert.equal(requests, 28)
    assert.equal(first.workspace.version, same.workspace.version)
    assert(first.workspace.nightscout?.lastSuccess)
    assert.equal(first.workspace.nightscout?.latestMeasurement, fromBeforeFirstSync)
    assert.equal(first.workspace.observations.points.length, 1)
    assert.equal(first.workspace.observations.points[0].value?.toFixed(1), '8.0')
    assert.equal(first.workspace.observations.insulin.length, 1)
    assert.match(insulinText(first.workspace.observations.insulin[0]), /2,3 ед.*не подтверждена/)
    assert.equal(actualTotal(first.workspace.observations.insulin), null)

    const duplicate = await read(await endpoint())
    assert.equal(duplicate.workspace.nightscout?.changed, 0)
    offset = 36
    const edit = await read(await endpoint())
    assert.equal(edit.workspace.nightscout?.changed, 1)
    assert.equal(edit.workspace.observations.points.length, 1)
    assert.equal(edit.workspace.observations.points[0].value?.toFixed(1), '10.0')

    authorized = false
    const failure = await endpoint()
    assert.equal(failure.status, 502)
    const last = await read(failure)
    assert.match(last.message ?? '', /отклонил доступ/)
    assert.equal(last.workspace.nightscout?.lastSuccess, edit.workspace.nightscout?.lastSuccess)
    assert.deepEqual(last.workspace.observations, edit.workspace.observations)

    const demo = await read(await fetch(base + '/api/demo'))
    assert.equal(demo.workspace.nightscout, undefined)
    assert(!demo.workspace.observations.points.some(row => row.source === 'Nightscout'))
  } finally {
    await close(api)
    await close(remote)
  }
})

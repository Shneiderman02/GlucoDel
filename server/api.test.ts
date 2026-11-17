import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, rmdirSync} from 'node:fs'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {createApi} from './api.ts'
import {newWorkspace, type Workspace} from '../src/workspace.ts'

const cgm = 'measured_at,glucose_mmol_l\n2026-11-16T10:00:00Z,6.2\n2026-11-16T13:15:00+03:00,8.1'
const pump = 'event_id;started_at;ended_at;type;actual_units;planned_units;status;mode\n' +
  'e1;2026-11-16T13:01:00+03:00;;bolus;1,2;2,2;interrupted;ручной\n' +
  'e2;2026-11-16T13:15:00+03:00;;bolus;;0,5;cancelled;'
const entry = {
  id: 'archive-test', title: 'Архивный обед', at: Date.parse('2026-11-16T13:00:00+03:00'),
  products: [{id: 'p', name: 'Тестовый продукт', grams: 100, carbs: 0, energy: 200, protein: 5, fat: null}],
}
type Result = {workspace: Workspace; message?: string; imported?: {added: number; duplicates: number}}

test('HTTP API сохраняет архив, проверяет импорт и изолирует демо', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'glucodel-'))
  const path = join(directory, 'workspace.sqlite')
  const study = newWorkspace('study')
  study.featuredMealId = 'study-meal'
  study.state.meals = [{id: 'study-meal', title: 'Запись из исследования', at: entry.at, products: [], loggedCarbs: 70}]
  study.observations.points = [{id: 'study-cgm', at: entry.at, value: 7.4, received: null, source: 'AZT1D'}]
  const start = async (seed?: Workspace) => {
    const server = createApi(path, undefined, undefined, seed)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address === 'object')
    return {
      base: 'http://127.0.0.1:' + address.port,
      async close() {
        const closed = once(server, 'close')
        server.close()
        await closed
      },
    }
  }
  let app: Awaited<ReturnType<typeof start>> | undefined
  try {
    app = await start(study)
    const get = async (dataset: 'demo' | 'archive' | 'study') => {
      const response = await fetch(app!.base + '/api/' + dataset)
      assert.equal(response.status, 200)
      return (await response.json() as Result).workspace
    }
    const post = async (version: number, action: unknown, expected = 200, origin?: string) => {
      const response = await fetch(app!.base + '/api/archive', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...(origin ? {origin} : {})},
        body: JSON.stringify({version, action}),
      })
      const result = await response.json() as Result
      assert.equal(response.status, expected, result.message)
      return result
    }

    const empty = await get('archive')
    assert.equal(empty.version, 0)
    assert.deepEqual(empty.state.meals, [])
    assert.deepEqual(empty.observations.points, [])
    await post(0, {type: 'import', kind: 'cgm', content: cgm}, 403, 'https://outside.example')
    const first = await post(0, {type: 'import', kind: 'cgm', content: cgm})
    assert.deepEqual(first.imported, {added: 2, duplicates: 0})
    assert.deepEqual(first.workspace.observations.points.map(point => point.value), [6.2, null, null, 8.1])
    assert.equal(first.workspace.observations.points[0].received, null)

    const duplicate = await post(1, {type: 'import', kind: 'cgm', content: cgm})
    assert.deepEqual(duplicate.imported, {added: 0, duplicates: 2})
    assert.equal(duplicate.workspace.version, 1)
    const invalid = await post(1, {type: 'import', kind: 'cgm', content: cgm + '\n2026-02-30T12:00:00Z,4.2'}, 400)
    assert.match(invalid.message ?? '', /Строка 4/)
    await post(1, {type: 'import', kind: 'cgm', content: cgm.replace('6.2', '5.9')}, 400)
    assert.equal((await get('archive')).version, 1)

    const second = await post(1, {type: 'import', kind: 'pump', content: pump})
    const [interrupted, cancelled] = second.workspace.observations.insulin
    assert.deepEqual([interrupted.status, interrupted.actual, interrupted.planned], ['interrupted', 1.2, 2.2])
    assert.deepEqual([cancelled.status, cancelled.actual, cancelled.planned], ['cancelled', null, 0.5])
    const concurrent = await post(1, {type: 'meal', meal: entry}, 409)
    assert.equal(concurrent.workspace.version, 2)
    await post(2, {type: 'meal', meal: {...entry, products: [{...entry.products[0], grams: -1}]}}, 400)
    await post(2, {type: 'meal', meal: entry})
    await post(3, {type: 'meal', meal: {...entry, title: 'Исправленный архивный обед'}})
    await post(4, {type: 'reset'}, 400)
    const studyWrite = await fetch(app.base + '/api/study', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({version: 0, action: {type: 'meal', meal: entry}})})
    assert.equal(studyWrite.status, 405)

    await app.close()
    app = await start()
    const archive = await get('archive')
    assert.equal(archive.version, 4)
    assert.equal(archive.state.meals[0].title, 'Исправленный архивный обед')
    assert.deepEqual(archive.state.revisions[entry.id][0].meal, entry)
    assert.equal(archive.observations.insulin.length, 2)
    assert.deepEqual(await get('study'), study)
    assert(!archive.state.meals.some(meal => meal.id === 'study-meal'))

    const demo = await get('demo')
    assert(demo.state.meals.some(meal => meal.id === 'lunch-16'))
    assert(!demo.state.meals.some(meal => meal.id === entry.id))
    assert(!demo.observations.points.some(point => point.source === 'Выгрузка CGM'))
  } finally {
    await app?.close()
    rmSync(path, {force: true})
    rmdirSync(directory)
  }
})

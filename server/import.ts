import {type CGM, type Insulin, minute} from '../src/model.ts'
import type {Observations} from '../src/workspace.ts'

export type ImportKind = 'cgm' | 'pump'
const columns = {
  cgm: ['measured_at', 'glucose_mmol_l'],
  pump: ['event_id', 'started_at', 'ended_at', 'type', 'actual_units', 'planned_units', 'status', 'mode'],
} as const
const timeFormat = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/

function timestamp(value: string) {
  if (!timeFormat.test(value)) throw new Error('Нужно время ISO 8601 с часовым поясом.')
  const calendar = Date.parse(value.slice(0, 10) + 'T00:00:00Z')
  const parsed = Date.parse(value)
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10) ||
      !Number.isFinite(parsed)) throw new Error('Некорректная дата или время.')
  return parsed
}

function quantity(value: string) {
  if (value === '') return null
  if (!/^\d+(?:[.,]\d+)?$/.test(value) || !Number.isFinite(Number(value.replace(',', '.')))) {
    throw new Error('Введите неотрицательное число или оставьте значение пустым.')
  }
  return Number(value.replace(',', '.'))
}

function recipe(kind: ImportKind, input: string) {
  const rows = input.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const delimiter = rows[0].includes(';') ? ';' : ','
  const split = (row: string) => row.split(delimiter).map(value => value.trim())
  const expected = columns[kind]
  if (split(rows[0]).join(',') !== expected.join(',')) throw new Error('Ожидаемые столбцы: ' + expected.join(', '))
  if (rows.length === 1) throw new Error('В файле нет записей.')
  if (rows.length > 50_001) throw new Error('Файл содержит больше 50 000 записей.')
  return rows.slice(1).flatMap((row, index) => {
    if (!row.trim()) return []
    const cells = split(row)
    if (cells.length !== expected.length || row.includes('"')) throw new Error('Строка ' + (index + 2) + ': проверьте разделители и число столбцов.')
    return [{cells, line: index + 2}]
  })
}

const glucoseRow = ([rawTime, rawValue]: string[]): CGM => {
  const at = timestamp(rawTime)
  const value = quantity(rawValue)
  if (value !== null && (value <= 0 || value > 100)) throw new Error('Значение глюкозы в ммоль/л должно быть в диапазоне от 0 до 100, не включая ноль.')
  return {id: 'cgm-' + at, at, received: null, value, source: 'Выгрузка CGM'}
}
const pumpRow = ([id, start, finish, type, actual, planned, status, mode]: string[]): Insulin => {
  const at = timestamp(start)
  const end = finish ? timestamp(finish) : undefined
  const actualUnits = quantity(actual)
  const plannedUnits = quantity(planned) ?? undefined
  if (!/^[\w.-]{1,80}$/.test(id) || (type !== 'bolus' && type !== 'basal') ||
      (status !== 'given' && status !== 'interrupted' && status !== 'cancelled') ||
      (end !== undefined && end <= at) || (status === 'cancelled' && actualUnits !== null && actualUnits !== 0) ||
      mode.length > 100) throw new Error('Проверьте идентификатор, интервал, тип и статус подачи.')
  return {
    id: 'pump-' + id, at, end, type, actual: status === 'cancelled' ? null : actualUnits, planned: plannedUnits, status,
    title: (type === 'basal' ? 'Базал' : 'Болюс') + (status === 'cancelled' ? ' отменён' : status === 'interrupted' ? ' прерван' : ''), mode: mode || 'Не указан', source: 'Выгрузка помпы',
  }
}

export function parseImport(kind: ImportKind, content: string) {
  return recipe(kind, content).map(({cells, line}) => {
    try {
      return kind === 'cgm' ? glucoseRow(cells) : pumpRow(cells)
    } catch (error) {
      throw new Error('Строка ' + line + ': ' + (error as Error).message)
    }
  })
}

export function mergeImport(current: Observations, kind: ImportKind, content: string) {
  const rows = parseImport(kind, content)
  const existing = kind === 'cgm' ? current.points : current.insulin
  const observations = new Map<string, CGM | Insulin>(existing.map(row => [row.id, row]))
  let added = 0
  for (const row of rows) {
    const previous = observations.get(row.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('Конфликт с ранее загруженной записью ' + row.id + '. Весь файл оставлен без изменений.')
    if (!previous) {
      observations.set(row.id, row)
      added++
    }
  }
  const sorted = [...observations.values()].sort((a, b) => a.at - b.at)
  const result = kind === 'cgm' ? {...current, points: sorted as CGM[]} : {...current, insulin: sorted as Insulin[]}
  return {result, added, duplicates: rows.length - added}
}

export function insertCgmGaps(points: CGM[]) {
  return points.flatMap((point, index) => {
    const prior = points[index - 1]
    if (!prior || point.at - prior.at <= 7.5 * minute || prior.value === null || point.value === null) return [point]
    const start = prior.at + 5 * minute
    const end = point.at - 5 * minute
    const missing = (at: number) => ({...point, at, id: 'gap-' + at, value: null})
    return end > start ? [missing(start), missing(end), point] : [missing(start), point]
  })
}

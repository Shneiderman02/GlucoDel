import {describe, expect, it} from 'vitest'
import {actualTotal, asNumber, atLocal, defaultMeal, gapRanges, insulin, measurements, minute, nutrition, within} from './model'

const portion = {id: 'p', name: 'Контрольный продукт', grams: 150, protein: 10, fat: 8, carbs: 20, energy: 200}

describe('Питание', () => {
  it('пересчитывает БЖУ и указанную калорийность на порцию', () => {
    const {totals} = nutrition([portion])
    expect(Object.values(totals).map(total => total.value)).toEqual([15, 12, 30, 300])
    expect(Object.values(totals).every(total => total.complete)).toBe(true)
  })
  it('различает пустое поле и ноль, отмечает частичную сумму', () => {
    expect(asNumber('')).toBeNull()
    expect(asNumber('0')).toBe(0)
    expect(nutrition([{...portion, carbs: null}]).totals.carbs).toEqual({value: null, complete: false})
    expect(nutrition([{...portion, fat: null}, {...portion, id: 'other', fat: 0}]).totals.fat).toEqual({value: 0, complete: false})
    expect(nutrition([{...portion, fat: 0}]).totals.fat).toEqual({value: 0, complete: true})
  })
})

describe('Шкала времени', () => {
  it('включает границы окна и дня в МСК и сортирует события', () => {
    const start = defaultMeal.at
    const end = start + 120 * minute
    expect(within([{at: end + 1}, {at: end}, {at: start}, {at: start - 1}], start, end).map(item => item.at)).toEqual([start, end])
    const dayStart = atLocal('2026-11-16T00:00')
    const dayEnd = atLocal('2026-11-16T23:59:59.999')
    expect(within([{at: dayStart - 1}, {at: dayStart}, {at: dayEnd}, {at: dayEnd + 1}], dayStart, dayEnd)).toHaveLength(2)
  })
  it('оставляет пропуск CGM неизвестным и объединяет соседние пропуски', () => {
    const start = defaultMeal.at
    const rows = within(measurements('gap'), start, start + 120 * minute)
    expect(rows.filter(row => row.value === null)).toHaveLength(4)
    expect(gapRanges(rows)).toEqual([{start: start + 70 * minute, end: start + 85 * minute}])
    expect(within(measurements('full'), start, start + 120 * minute).every(row => row.value !== null)).toBe(true)
  })
  it('суммирует только сообщённую фактическую подачу', () => {
    const actual = insulin.find(event => event.id === 'bolus2')!
    const cancelled = insulin.find(event => event.id === 'cancel1')!
    expect(actualTotal([{...cancelled, actual: .6}])).toBeNull()
    expect(actualTotal([actual, cancelled])).toBe(1.8)
    expect(actualTotal([])).toBeNull()
  })
})

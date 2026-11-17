import {CalendarDays, ChevronRight, CircleAlert, FileText, Plus} from 'lucide-react'
import {type Meal, type Product, date, demoDay, localInput, number, nutrition, nutrients, labels, unit, time, atLocal, loggedCarbsDescription} from './model'

export function Nutrition({products}: {products: Product[]}) {
  const {totals} = nutrition(products)
  return <dl className="nutrition">
    {nutrients.map(key => <div key={key}>
      <dt>{labels[key]}</dt>
      <dd>{totals[key].value === null ? '—' : number(totals[key].value)} <small>{unit(key)}</small></dd>
      {!totals[key].complete && <small className="incomplete">неполные данные</small>}
    </div>)}
  </dl>
}

export function Notice({children}: {children: React.ReactNode}) {
  return <div className="notice"><CircleAlert size={17} aria-hidden="true"/><div>{children}</div></div>
}

export function Empty({children}: {children: React.ReactNode}) {
  return <div className="empty"><FileText size={24} aria-hidden="true"/><p>{children}</p></div>
}

export type Period = {from: string; to: string; preset: number}
export const makePeriod = (days: number, day = demoDay): Period => ({
  from: localInput(atLocal(day + 'T12:00') - (days - 1) * 86_400_000).slice(0, 10), to: day, preset: days,
})
export const periodBounds = (period: Period) => ({
  start: atLocal(period.from + 'T00:00'), end: atLocal(period.to + 'T23:59:59.999'),
})
export const validPeriod = (period: Period) => Boolean(period.from && period.to && period.from <= period.to)

export function PeriodPicker({value, change, anchor, fullPeriod}: {
  value: Period; change: (value: Period) => void; anchor: string; fullPeriod?: Pick<Period, 'from' | 'to'>
}) {
  return <div className="period-tools">
    <div className="segmented" aria-label="Период">
      {[[1, 'День'], [7, '7 дней'], [14, '14 дней'], [30, '30 дней']].map(([days, label]) =>
        <button type="button" key={days} aria-pressed={value.preset === days} onClick={() => change(makePeriod(Number(days), anchor))}>{label}</button>)}
    </div>
    {fullPeriod && <button className="button secondary" type="button" onClick={() => change({...fullPeriod, preset: 0})}>Весь период</button>}
    <div className="date-inputs">
      <label><span>С</span><input aria-label="Дата начала" type="date" required value={value.from} onChange={event => change({...value, from: event.target.value, preset: 0})}/></label>
      <label><span>По</span><input aria-label="Дата окончания" type="date" required value={value.to} onChange={event => change({...value, to: event.target.value, preset: 0})}/></label>
    </div>
    {!validPeriod(value) && <p role="alert" className="field-error">Укажите обе даты. Начало периода должно быть раньше окончания или совпадать с ним.</p>}
  </div>
}

export function MealRows({meals, open, edit}: {meals: Meal[]; open: (id: string) => void; edit?: (id: string) => void}) {
  return meals.length ? <ul className="meal-list">
    {meals.map(meal => {
      const {grams, totals} = nutrition(meal.products)
      return <li key={meal.id}>
        <div className="row-content">
          <span className="row-icon"><CalendarDays size={19}/></span>
          <div><small>{date(meal.at)} · {time(meal.at)}</small><h3>{meal.title}</h3>
            {meal.loggedCarbs === undefined ? <p>{number(grams)} г · {totals.carbs.value === null ? 'Углеводы неизвестны' : number(totals.carbs.value) + ' г углеводов'}
              {Object.values(totals).some(total => !total.complete) && <span className="incomplete"> · неполные данные</span>}</p>
              : <p>{loggedCarbsDescription(meal.loggedCarbs)}</p>}
          </div>
        </div>
        <div className="row-actions">
          {edit && meal.loggedCarbs === undefined && <button className="button quiet" onClick={() => edit(meal.id)} aria-label={'Изменить ' + meal.title}>Изменить</button>}
          <button className="button quiet" onClick={() => open(meal.id)} aria-label={'Открыть разбор ' + meal.title}>Разбор <ChevronRight size={16}/></button>
        </div>
      </li>
    })}
  </ul> : <Empty>За выбранный период нет записей о еде.</Empty>
}

export function AddButton({onClick}: {onClick: () => void}) {
  return <button className="button primary" onClick={onClick}><Plus size={19}/>Добавить еду</button>
}

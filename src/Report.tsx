import {ArrowLeft, Printer, FileDown} from 'lucide-react'
import {type Meal, type Scenario, date, forecastReason, gapRanges, insulinText, number, nutrition, time, within} from './model'
import type {Observations} from './workspace'
import {Empty, Notice, PeriodPicker, type Period, periodBounds, validPeriod, Nutrition} from './ui'

export function Report({period, change, meals, observations, scenario, isArchive, print, goPrint, goBack, anchor}: {
  period: Period; change: (period: Period) => void; meals: Meal[]; observations: Observations; scenario: Scenario; isArchive: boolean;
  print: boolean; goPrint: () => void; goBack: () => void; anchor: string;
}) {
  const {start, end} = periodBounds(period)
  const food = within(meals, start, end)
  const glucose = within(observations.points, start, end)
  const doses = within(observations.insulin, start, end)
  const activities = within(observations.context, start, end)
  const gaps = gapRanges(glucose)
  const valid = validPeriod(period)
  return <>
    <div className="page-intro screen-only">
      {print && <button className="button quiet back" onClick={goBack}><ArrowLeft size={17}/>К предпросмотру</button>}
      <div className="section-heading"><div><h1>{print ? 'Представление для печати' : 'Отчёт'}</h1>
      <p>{print ? 'В диалоге печати выберите «Сохранить как PDF».' : 'Выберите период и проверьте, какие данные войдут в отчёт.'}</p></div>
      <button className="button primary" disabled={!valid} onClick={print ? () => window.print() : goPrint}>{print ? <Printer size={18}/> : <FileDown size={18}/>}Сохранить отчёт</button></div>
    </div>
    {!print && <PeriodPicker value={period} change={change} anchor={anchor}/>}
    {valid && <article className="panel report-sheet" aria-label="Предпросмотр отчёта">
      <header><span className="demo-badge"><i/>{isArchive ? 'Локальный архив' : 'Демо · синтетические данные'}</span><h2>Отчёт о питании и глюкозе</h2>
        <p>{period.from} — {period.to} · МСК (UTC+3)</p></header>
      <section><h3>Ограничения данных</h3><p>Историческая выгрузка не обновляется в реальном времени.</p>
        <Notice>{forecastReason(scenario, glucose)}{gaps.length > 0 && ' Пробел CGM: ' + gaps.map(gap => date(gap.start) + ', ' + time(gap.start) + '–' + time(gap.end)).join('; ') + '.'}</Notice>
      </section>
      {!food.length && !glucose.length && !doses.length && !activities.length && <Empty>За выбранный период нет наблюдений.</Empty>}
      <section><h3>Еда · Дневник</h3>{food.length ? food.map(meal => <div className="report-meal" key={meal.id}>
        <p><strong>{date(meal.at)} · {time(meal.at)} · {meal.title}</strong> · {number(nutrition(meal.products).grams)} г</p>
        <p>{meal.products.map(product => product.name + ' ' + number(product.grams) + ' г').join(' · ')}</p><Nutrition products={meal.products}/>
      </div>) : <p>Записей о еде нет.</p>}</section>
      <section><h3>Инсулин · {isArchive ? 'Источники архива' : 'Демо-помпа'}</h3>{doses.length ? <ul className="plain-list">{doses.map(dose =>
        <li key={dose.id}>{date(dose.at)} · {time(dose.at)}{dose.end ? '–' + time(dose.end) : ''} · {dose.title} · {insulinText(dose)} · {dose.source}</li>
      )}</ul> : <p>Нет данных о фактической подаче.</p>}</section>
      {activities.length > 0 && <section><h3>Активность · Дневник</h3><ul className="plain-list">{activities.map(activity => <li key={activity.id}>{date(activity.at)} · {time(activity.at)} · {activity.title} · {activity.description}</li>)}</ul></section>}
      <section><h3>Глюкоза · {isArchive ? 'Источники архива' : 'Демо-CGM'}</h3>
        {glucose.length ? <div className="table-wrap" role="region" tabIndex={0} aria-label="Таблица измерений глюкозы">
          <table><thead><tr><th scope="col">Дата и время</th><th scope="col">Глюкоза, ммоль/л</th><th scope="col">Получено, МСК</th>{isArchive && <th scope="col">Источник</th>}</tr></thead>
            <tbody>{glucose.map(point => <tr key={point.id}><td>{date(point.at)} · {time(point.at)}</td><td>{point.value === null ? 'Пробел CGM' : number(point.value)}</td><td>{point.value === null || point.received === null ? '—' : time(point.received)}</td>{isArchive && <td>{point.value === null ? '—' : point.source}</td>}</tr>)}</tbody>
          </table>
        </div> : <p>За период нет измерений CGM.</p>}
      </section>
    </article>}
  </>
}

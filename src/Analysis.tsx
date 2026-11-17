import {useMemo, useState} from 'react'
import {ArrowRight, CalendarDays, ChartNoAxesCombined, ChevronRight, Pencil, Radio} from 'lucide-react'
import type {Observations} from './workspace'
import {GlucoseChart, Marker} from './Chart'
import {Nutrition, Notice, Empty} from './ui'
import {type Meal, type Scenario, date, time, number, within, minute, timeline, forecastReason, gapRanges, actualTotal, insulinText, nutrition, studyTime, studyLimit, loggedCarbsDescription, localInput} from './model'

function startingMeasurement(points: Observations['points'], at: number) {
  return points.findLast(point => point.at <= at && point.at >= at - 10 * minute && point.value !== null)
}

function precedingBoluses(doses: Observations['insulin'], mealAt: number) {
  return within(doses, mealAt - 30 * minute, mealAt - 1).filter(event => event.type === 'bolus')
}

export function Analysis({meal, meals, observations, scenario, edit, compare, sources, open, replay}: {
  meal: Meal; meals: Meal[]; observations: Observations; scenario: Scenario; edit?: () => void; compare: () => void; sources: () => void; open: (id: string) => void; replay?: boolean;
}) {
  const [hours, setHours] = useState(2)
  const [selected, setSelected] = useState('')
  const end = meal.at + hours * 60 * minute
  const points = useMemo(() => within(observations.points, meal.at, end), [observations.points, meal.at, end])
  const series = useMemo(() => [{name: 'Измерения CGM', points, start: meal.at}], [points, meal.at])
  const events = timeline(meals, meal.at, end, observations.insulin, observations.context)
  const active = events.find(event => event.id === selected)
  const latest = points.findLast(point => point.value !== null)
  const selectMarker = (eventId: string) => {
    setSelected(eventId)
    if (window.matchMedia('(max-width: 640px)').matches) document.getElementById('event-' + eventId)?.focus()
  }
  const delayed = latest?.received != null && latest.received - latest.at > 5 * minute
  const gaps = gapRanges(points)
  const baseline = startingMeasurement(observations.points, meal.at)
  const isStudy = meal.loggedCarbs !== undefined
  const carbs = isStudy ? {value: meal.loggedCarbs!, complete: true} : nutrition(meal.products).totals.carbs
  const boluses = within(observations.insulin, meal.at, end).filter(event => event.type === 'bolus')
  const given = actualTotal(boluses)
  const priorBoluses = precedingBoluses(observations.insulin, meal.at)
  return <>
    <div className="analysis-top">
      <div className="page-intro"><div className="eyebrow"><span/>{isStudy ? 'Разбор записи из помпы' : 'Разбор приёма пищи'}</div><h1>{meal.title}</h1>
        <p className="episode-date"><CalendarDays size={16}/>{date(meal.at)}{(isStudy || replay) && ' ' + localInput(meal.at).slice(0, 4)} · {time(meal.at)} <span className="separator"/> {replay ? 'Шкала AZT1D' : isStudy ? studyTime : 'МСК (UTC+3)'}</p>
      </div>
      <div className="reading">
        <small>Последнее измерение в окне</small>
        <div className="reading-value">{latest?.value != null ? <><strong>{number(latest.value)}</strong> <span>ммоль/л</span></> : <strong>—</strong>}</div>
        <button className="reading-status" onClick={sources}><Radio size={14}/>{latest ? time(latest.at) + ' · ' + (delayed ? 'Задержка 45 мин' : 'Исторические данные') : 'Измерений нет'}<ChevronRight size={14}/></button>
      </div>
    </div>
    <div className="analysis-grid">
      <section className="panel plot-panel" aria-labelledby="plot-title">
        <div className="panel-header">
          <div><h2 id="plot-title">{isStudy ? 'Глюкоза после записи об углеводах' : 'Глюкоза после еды'}</h2><p>{time(meal.at)}–{time(end)} · {isStudy ? 'CGM и болюсы из журнала помпы' : 'CGM, питание и фактическая подача'}</p></div>
          <div className="segmented" aria-label="Окно анализа">
            {[2, 4].map(option => <button type="button" key={option} aria-pressed={hours === option} onClick={() => setHours(option)}>{option} ч</button>)}
          </div>
        </div>
        <dl className="episode-facts">
          <div><dt>{isStudy ? 'Глюкоза к моменту записи' : 'Глюкоза к началу еды'}</dt><dd>{baseline?.value != null ? number(baseline.value) + ' ммоль/л' : 'Нет измерения'}</dd>{baseline && <small>{time(baseline.at)} · CGM</small>}</div>
          <div><dt>{isStudy ? 'Углеводы по записи помпы' : 'Углеводы в порции'}</dt><dd>{carbs.value === null ? 'Нет данных' : number(carbs.value) + ' г'}</dd>{!carbs.complete && <small className="incomplete">неполные данные</small>}</div>
          <div><dt>Фактические болюсы в окне</dt><dd>{given === null ? 'Нет данных о подаче' : number(given) + ' ед.'}</dd>{given !== null && <small>По доступным событиям помпы</small>}</div>
        </dl>
        <GlucoseChart series={series} hours={hours} events={events} selected={selected} onSelect={selectMarker} lanes/>
        <div className="chart-notices">
          {gaps.length > 0 && <Notice><strong>Пробел CGM</strong> · {gaps.map(gap => time(gap.start) + '–' + time(gap.end)).join(', ')}</Notice>}
          {isStudy ? <small className="muted">Исторические данные · без прогноза</small>
            : <Notice><strong>Прогноз недоступен.</strong> {forecastReason(scenario, points, meal)}</Notice>}
        </div>
      </section>
      <section className="panel events-panel" aria-labelledby="events-title">
        <div className="panel-header"><div><h2 id="events-title">События</h2><p>На шкале {time(meal.at)}–{time(end)}</p></div></div>
        {priorBoluses.length > 0 && <div className="premeal"><h3>{isStudy ? 'За 30 минут до записи' : 'За 30 минут до еды'}</h3><ul className="plain-list">
          {priorBoluses.map(event => <li key={event.id}>{time(event.at)} · {event.title} · {insulinText(event)}</li>)}
        </ul></div>}
        <ol className="event-list">
          {events.map(event => <li key={event.id}>
            <button className="event-button" id={'event-' + event.id} type="button" onClick={() => setSelected(event.id === selected ? '' : event.id)} aria-expanded={event.id === selected}
              aria-label={time(event.at) + ' ' + event.title + ' · ' + event.description}>
              <Marker type={event.marker}/>
              <span><span className="event-meta"><time>{time(event.at)}</time><span> · {event.source}</span></span>
                <strong>{event.title}{event.mealId && event.mealId !== meal.id && <small>{isStudy ? ' · другая запись' : ' · другой приём пищи'}</small>}</strong>
                {event.category !== 'meal' && <span className="event-value">{event.description.split(' · режим:')[0]}</span>}
              </span>
              <ChevronRight className="event-chevron" size={16}/>
            </button>
            {active?.id === event.id && <div className="event-detail">
              <p>{event.end ? time(event.at) + '–' + time(event.end) + ' · ' : ''}{event.description}</p>
              {edit && event.mealId === meal.id && <button className="button quiet" onClick={edit}>Изменить запись <ArrowRight size={15}/></button>}
              {event.mealId && event.mealId !== meal.id && <button className="button quiet" onClick={() => open(event.mealId!)}>Открыть этот эпизод <ArrowRight size={15}/></button>}
            </div>}
          </li>)}
        </ol>
        {!events.some(event => event.category === 'insulin') && <p className="events-empty muted">Нет данных о подаче инсулина за это окно.</p>}
      </section>
    </div>
    {isStudy ? <section className="panel meal-panel">
      <div className="panel-header"><div><h2>Что известно о еде</h2><p>{studyLimit}</p></div></div>
      <p>{loggedCarbsDescription(meal.loggedCarbs!)}</p>
    </section> : <section className="panel meal-panel">
      <div className="panel-header"><div><h2>Порция и состав</h2><p>{meal.products.map(product => product.name + ' ' + number(product.grams) + ' г').join(' · ')}</p></div>
        {edit && <button className="button secondary" onClick={edit}><Pencil size={16}/>Изменить запись</button>}
      </div>
      <Nutrition products={meal.products}/>
    </section>}
    <div className="compare-cta"><button className="button primary" onClick={compare}><ChartNoAxesCombined size={18}/>Сравнить эпизоды<ArrowRight size={17}/></button></div>
  </>
}

export function Compare({meals, observations, left, right, choose, replay}: {
  meals: Meal[]; observations: Observations; left: Meal; right: Meal; choose: (a: string, b: string) => void; replay?: boolean;
}) {
  const [hours, setHours] = useState(2)
  const isStudy = left.loggedCarbs !== undefined || right.loggedCarbs !== undefined
  const series = useMemo(() => [left, right].map((meal, index) => ({
    name: index ? 'Эпизод Б' : 'Эпизод А', start: meal.at,
    points: within(observations.points, meal.at, meal.at + hours * 60 * minute),
  })), [left, right, observations.points, hours])
  return <>
    <div className="page-intro"><h1>Сравнение эпизодов</h1><p>{replay ? 'T+0 — время выбранной записи об углеводах или приёме пищи.' : isStudy ? 'Графики совмещены по времени записи углеводов в помпе (T+0). Одинаковые углеводы не означают одинаковый состав еды.' : 'Графики совмещены по времени начала еды (T+0).'}</p></div>
    <div className="compare-selects">
      {[left, right].map((meal, index) => <label key={index} className="compare-choice">
        <span><i className={index ? 'dash-key' : 'line-key'}/>{index ? 'Эпизод Б' : 'Эпизод А'}</span>
        <select aria-label={index ? 'Эпизод Б' : 'Эпизод А'} value={meal.id} onChange={event => index ? choose(left.id, event.target.value) : choose(event.target.value, right.id)}>
          {meals.map(option => <option key={option.id} disabled={option.id === (index ? left.id : right.id)} value={option.id}>{date(option.at)} · {time(option.at)} · {option.title}</option>)}
        </select>
      </label>)}
    </div>
    {left.id === right.id ? <Empty>Для сравнения нужны два разных эпизода.</Empty> : <>
      <section className="panel plot-panel compare-plot">
        <div className="panel-header"><div><h2>{replay ? 'Динамика глюкозы' : isStudy ? 'Глюкоза после записи об углеводах' : 'Глюкоза после еды'}</h2><p>{isStudy || replay ? 'Время от записи, мин' : 'Время от начала еды, мин'}</p></div>
          <div className="segmented" aria-label="Окно сравнения">{[2, 4].map(value => <button key={value} aria-pressed={value === hours} onClick={() => setHours(value)}>{value} ч</button>)}</div>
        </div>
        <GlucoseChart series={series} hours={hours} relative/>
      </section>
      <div className="compare-grid">
        {[left, right].map((meal, index) => {
          const end = meal.at + hours * 60 * minute
          const items = within(observations.insulin, meal.at, end)
          const total = actualTotal(items)
          const before = precedingBoluses(observations.insulin, meal.at)
          const events = timeline(meals, meal.at, end, observations.insulin, observations.context).filter(event => event.id !== meal.id && event.category !== 'insulin')
          const {points} = series[index]
          const start = startingMeasurement(observations.points, meal.at)
          const gaps = gapRanges(points)
          const available = points.filter(point => point.value !== null)
          const limited = available[0]?.at !== meal.at || available.at(-1)?.at !== end
          const delayed = available.some(point => point.received !== null && point.received - point.at > 5 * minute)
          return <section className="panel compare-details" key={meal.id} aria-label={series[index].name}>
            <small className="muted">{series[index].name} · {date(meal.at)} · {time(meal.at)}</small><h2>{meal.title}</h2>
            <p className="baseline">Исходная глюкоза · <strong>{start?.value == null ? (isStudy ? 'нет измерения к моменту записи' : 'нет измерения к началу еды') : number(start.value) + ' ммоль/л'}</strong>{start && start.at !== meal.at && ' · CGM в ' + time(start.at)}</p>
            {meal.loggedCarbs === undefined ? <><h3>Порция · {number(nutrition(meal.products).grams)} г</h3>
              <p>{meal.products.map(product => product.name + ' ' + number(product.grams) + ' г').join(' · ')}</p>
              <Nutrition products={meal.products}/></> : <><h3>{loggedCarbsDescription(meal.loggedCarbs)}</h3><p>Состав и порция неизвестны.</p></>}
            <h3>Фактическая подача · {total === null ? 'нет данных' : number(total) + ' ед. по доступным событиям'}</h3>
            {items.length ? <ul className="plain-list">{items.map(event => <li key={event.id}>{time(event.at)} · {event.title} · {insulinText(event)}{isStudy ? '' : ' · ' + event.mode.toLowerCase() + ' режим'}</li>)}</ul> : <p>Данных о подаче в окне нет.</p>}
            {before.length > 0 && <><h3>{isStudy ? 'Болюсы за 30 минут до записи' : 'Болюсы за 30 минут до еды'}</h3><ul className="plain-list">{before.map(event => <li key={event.id}>{time(event.at)} · {event.title} · {insulinText(event)}</li>)}</ul></>}
            <h3>Контекст</h3>
            {events.length ? <ul className="plain-list">{events.map(event => <li key={event.id}>{time(event.at)} · {event.category === 'meal' && !isStudy ? 'Другой приём пищи · ' : ''}{event.title} · {event.description}</li>)}</ul> : <p>Других событий в окне нет.</p>}
            {isStudy && <p>Нет данных о физической активности.</p>}
            <h3>Покрытие CGM</h3>
            {!available.length && <p>Измерений в окне нет.</p>}
            {available.length > 0 && gaps.length === 0 && !limited && <p>В выгрузке за окно нет пробелов</p>}
            {available.length > 0 && limited && <p>Доступные измерения · {time(available[0].at)}–{time(available.at(-1)!.at)}</p>}
            {gaps.length > 0 && <p>Пробел CGM · {gaps.map(gap => time(gap.start) + '–' + time(gap.end)).join(', ')}</p>}
            {delayed && <p>Измерения получены с задержкой 45 мин.</p>}
          </section>
        })}
      </div>
    </>}
  </>
}

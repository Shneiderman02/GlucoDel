import {useEffect, useRef, useState} from 'react'
import {Chart as ChartJS, LineController, LineElement, PointElement, LinearScale, Tooltip} from 'chart.js'
import {Footprints, Utensils, Syringe, X} from 'lucide-react'
import {type CGM, type TimelineEvent, minute, number, time} from './model'

ChartJS.register(LineController, LineElement, PointElement, LinearScale, Tooltip)

export const chartColors = ['#176e5c', '#82569c']
type Series = {name: string; points: CGM[]; start: number}
const yWidth = 43

export function Marker({type}: {type: string}) {
  if (type === 'meal') return <span className="marker meal"><Utensils size={13}/></span>
  if (type === 'activity') return <span className="marker activity"><Footprints size={14}/></span>
  if (type === 'cancel') return <span className="marker cancel"><X size={14}/></span>
  if (type === 'basal') return <span className="marker basal"><span/></span>
  return <span className="marker bolus"><Syringe size={13}/></span>
}

export function GlucoseChart({series, hours, relative = false, events, selected, onSelect, lanes}: {
  series: Series[]; hours: number; relative?: boolean; events?: TimelineEvent[]; selected?: string;
  onSelect?: (id: string) => void; lanes?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [selection, setSelection] = useState<{series: number; id: string} | null>(null)
  const available = series.map(item => item.points.filter(point => point.value !== null))
  const firstSeries = available.findIndex(points => points.length > 0)
  const currentSeries = selection && available[selection.series]?.some(point => point.id === selection.id) ? selection.series : firstSeries
  const activePoints = available[currentSeries] ?? []
  const activeIndex = Math.max(0, activePoints.findIndex(point => point.id === selection?.id))
  const activePoint = activePoints[activeIndex]
  const duration = hours * 60
  const start = series[0].start

  useEffect(() => {
    if (!canvas.current) return
    const line = new ChartJS(canvas.current, {
      type: 'line',
      data: {datasets: series.map((item, index) => ({
        label: item.name, data: item.points.map(point => ({x: (point.at - item.start) / minute, y: point.value})),
        borderColor: chartColors[index], backgroundColor: chartColors[index],
        borderWidth: 2.5, borderDash: index ? [7, 4] : [], spanGaps: false,
        pointRadius: item.points.length === 1 ? 4 : item.points.map(point => point.id === activePoint?.id ? 4 : 0),
        pointHoverRadius: 5, pointHitRadius: 10, tension: 0,
      }))},
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: {mode: 'nearest', intersect: false},
        onClick: (_, elements) => {
          const element = elements[0]
          const point = element && series[element.datasetIndex].points[element.index]
          if (point?.value != null) setSelection({series: element.datasetIndex, id: point.id})
        },
        scales: {
          x: {
            type: 'linear', min: 0, max: duration,
            grid: {color: '#edf0eb'}, border: {color: '#dce4df'},
            ticks: {display: false, stepSize: 30},
          },
          y: {
            type: 'linear', min: 4, max: 12,
            afterFit: scale => {scale.width = yWidth - 1},
            grid: {color: '#e7ece8', tickLength: 0}, border: {display: false, dash: [3, 4]},
            ticks: {stepSize: 2, color: '#49605b', padding: 10, font: {family: 'Inter Variable', size: 11}},
          },
        },
        layout: {padding: {right: 14, left: 1, top: 8}},
        plugins: {tooltip: {callbacks: {
          title: values => {
            const item = values[0]
            const source = series[item.datasetIndex]
            const point = source.points[item.dataIndex]
            return relative ? 'T+' + ((point.at - source.start) / minute) + ' мин · ' + time(point.at) : time(point.at)
          },
          label: item => item.dataset.label + ' · ' + number(item.parsed.y ?? 0) + ' ммоль/л',
        }}},
      },
    })
    return () => line.destroy()
  }, [series, activePoint, duration, relative])

  const labels = Array.from({length: 5}, (_, index) => duration * index / 4)
  return <div className="chart">
    <div className="chart-unit">ммоль/л</div>
    <div className="chart-canvas">
      <canvas ref={canvas} role="img" aria-label={relative ? 'График глюкозы относительно времени еды' : 'График измерений глюкозы'}/>
      {firstSeries < 0 && <div className="chart-empty">В этом окне нет измерений CGM</div>}
    </div>
    {lanes && <div className="lanes" aria-label="Дорожки событий">
      {[['meal', 'Еда'], ['insulin', 'Инс.'], ['activity', 'Акт.']].map(([key, title]) => <div className="lane" key={key}>
        <span className="lane-title" title={{meal: 'Еда', insulin: 'Инсулин', activity: 'Активность'}[key]}>{title}</span>
        <div className="lane-track">
          {events?.filter(event => event.category === key).map(event => {
            const left = (event.at - start) / minute / duration * 100
            const width = event.end ? Math.min(100 - left, (event.end - event.at) / minute / duration * 100) : 0
            return <span key={event.id}>
              {width > 0 && <span className="basal-span" style={{left: left + '%', width: width + '%'}}/>}
              <button className="lane-dot" style={{left: left + '%'}} type="button" aria-label={time(event.at) + ' ' + event.title}
                title={time(event.at) + ' · ' + event.title} aria-pressed={selected === event.id} onClick={() => onSelect?.(event.id)}>
                <Marker type={event.marker}/>
              </button>
            </span>
          })}
        </div>
      </div>)}
    </div>}
    <div className="chart-axis" aria-hidden="true">{labels.map(label => <span key={label}>{relative ? 'T+' + label : time(start + label * minute)}</span>)}</div>
    <div className="chart-legend">
      {series.map((item, index) => <span key={item.name}><i className={index ? 'dash-key' : 'line-key'}/>{item.name}</span>)}
      {lanes && <><span><Marker type="meal"/>Еда</span><span><Marker type="bolus"/>Болюс</span><span><Marker type="basal"/>Базал</span><span><Marker type="activity"/>Активность</span></>}
    </div>
    {activePoint && activePoint.value !== null && <div className="point-reader">
      <label>Измерение{series.length > 1 && <select aria-label="Ряд измерений" value={currentSeries} onChange={event => {
        const index = Number(event.target.value)
        setSelection({series: index, id: available[index][0].id})
      }}>{series.map((item, index) => <option key={index} value={index} disabled={!available[index].length}>{item.name}</option>)}</select>}</label>
      <div className="point-controls">
        <button type="button" aria-label="Предыдущее измерение" disabled={activeIndex === 0} onClick={() => setSelection({series: currentSeries, id: activePoints[activeIndex - 1].id})}>‹</button>
        <output aria-live="polite">{time(activePoint.at)} · <strong>{number(activePoint.value)} ммоль/л</strong></output>
        <button type="button" aria-label="Следующее измерение" disabled={activeIndex >= activePoints.length - 1} onClick={() => setSelection({series: currentSeries, id: activePoints[activeIndex + 1].id})}>›</button>
      </div>
    </div>}
  </div>
}

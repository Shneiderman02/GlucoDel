import {useRef, useState, type FormEvent} from 'react'
import {FileUp, Database, RefreshCw} from 'lucide-react'
import {type Upload} from './storage'
import type {Observations, NightscoutStatus} from './workspace'
import {date, time} from './model'
import {AddButton} from './ui'

const limit = 3 * 1024 * 1024
const samples = {
  cgm: 'measured_at,glucose_mmol_l\n2026-11-16T12:55:00+03:00,6.1\n2026-11-16T13:00:00+03:00,6.2\n2026-11-16T13:05:00+03:00,6.4\n2026-11-16T13:20:00+03:00,7.1\n',
  pump: 'event_id,started_at,ended_at,type,actual_units,planned_units,status,mode\n001,2026-11-16T12:55:00+03:00,,bolus,2.1,2.1,given,ручной\n002,2026-11-16T13:10:00+03:00,,bolus,0.4,0.8,interrupted,ручной\n',
}

function NightscoutSource({status, sync}: {status?: NightscoutStatus; sync: () => Promise<void>}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = (at: number) => date(at) + ', ' + time(at) + ' МСК'
  return <section className="panel source-panel nightscout-source">
    <h2>Nightscout</h2>
    {status?.configured ? <>
      <p>Получаем историю каждые 5 минут, пока запущен GlucoDel.</p>
      <dl>
        <div><dt>Последняя успешная синхронизация</dt><dd>{status.lastSuccess ? label(status.lastSuccess) : 'Пока не было'}</dd></div>
        <div><dt>Последнее измерение CGM</dt><dd>{status.latestMeasurement ? label(status.latestMeasurement) : 'Данных пока нет'}</dd></div>
      </dl>
      {status.lastSuccess && !status.latestMeasurement && <p>Nightscout ответил, но показаний CGM в полученной истории нет.</p>}
      {(error || status.error) && <p className="field-error" role="alert">{status.error || error}</p>}
      <p>Записи о болюсах из Nightscout отображаются отдельно от подтверждённой подачи.</p>
      <div className="form-actions"><button className="button secondary" disabled={busy || status.syncing} onClick={async () => {
        setBusy(true)
        setError('')
        try {
          await sync()
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Не удалось связаться с Nightscout.')
        } finally {
          setBusy(false)
        }
      }}><RefreshCw size={16}/>{busy || status.syncing ? 'Синхронизируем…' : 'Синхронизировать сейчас'}</button></div>
    </> : <p>Чтобы подключить удалённую историю, добавьте адрес Nightscout и отдельный токен чтения в локальный файл <code>.env.local</code>, затем перезапустите GlucoDel.</p>}
  </section>
}

export function Archive({observations, upload, add, nightscout, sync}: {
  observations: Observations; nightscout?: NightscoutStatus; sync: () => Promise<void>; upload: (action: Upload) => Promise<{added: number; duplicates: number}>; add: () => void;
}) {
  const [kind, setKind] = useState<Upload['kind']>('cgm')
  const [file, setFile] = useState<File>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file || pending.current) return
    setError('')
    setMessage('')
    if (file.size > limit) {
      setError('Выберите CSV размером до 3 МБ.')
      return
    }
    pending.current = true
    setSaving(true)
    try {
      const result = await upload({type: 'import', kind, content: await file.text()})
      setMessage('Добавлено: ' + result.added + '. Повторов пропущено: ' + result.duplicates + '.')
      setFile(undefined)
      if (input.current) input.current.value = ''
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось прочитать или импортировать файл.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  const points = observations.points.filter(point => point.value !== null)
  const first = points[0]
  const last = points.at(-1)
  return <>
    <div className="page-intro section-heading">
      <div><h1>Импорт данных</h1><p>Подключите Nightscout или загрузите CSV. Чтобы разобрать эпизод, добавьте приём пищи на то же время.</p></div>
      <a className="button secondary" href="?workspace=demo#/sources">Вернуться в демо</a>
    </div>
    <NightscoutSource status={nightscout} sync={sync}/>
    <div className="source-grid">
      <section className="panel source-panel">
        <span className="row-icon"><FileUp size={19}/></span><h2>Загрузить CSV</h2>
        <p>Поддерживаются шаблоны GlucoDel. Форматы производителей пока требуют преобразования.</p>
        <form className="archive-fields" onSubmit={submit}>
          <label>Тип выгрузки<select value={kind} disabled={saving} onChange={event => setKind(event.target.value as Upload['kind'])}>
            <option value="cgm">Измерения CGM</option>
            <option value="pump">События помпы</option>
          </select></label>
          <label>CSV-файл<input ref={input} type="file" accept=".csv,text/csv" required disabled={saving}
            aria-describedby={error ? 'import-error' : undefined} onChange={event => {setFile(event.target.files?.[0]); setError(''); setMessage('')}}/></label>
          {error && <p id="import-error" className="field-error" role="alert">{error}</p>}
          <button type="submit" className="button primary" disabled={!file || saving}>{saving ? 'Загружаем…' : 'Импортировать выгрузку'}</button>
        </form>
        {message && <p className="archive-result" role="status">{message}</p>}
        <details className="archive-format"><summary>Как подготовить файл</summary>
          <p>UTF-8, время с часовым поясом, разделитель — запятая или точка с запятой. Заголовок выбранного шаблона:</p>
          <code>{samples[kind].split('\n')[0]}</code>
          <a href={'data:text/csv;charset=utf-8,' + encodeURIComponent(samples[kind])} download={'glucodel-' + kind + '-example.csv'}>Скачать пример CSV</a>
        </details>
      </section>
      <section className="panel source-panel">
        <span className="row-icon"><Database size={19}/></span><h2>Локальный архив</h2>
        <p>Измерения CGM: <strong>{points.length}</strong></p>
        <p>События помпы: <strong>{observations.insulin.length}</strong></p>
        {first && last && <p>Данные CGM с {date(first.at)}, {time(first.at)} по {date(last.at)}, {time(last.at)} (МСК)</p>}
        <p>Файлы обрабатываются сервером на этом компьютере. Архив хранится отдельно от демонстрационных данных.</p>
        <div className="form-actions"><AddButton onClick={add}/></div>
      </section>
    </div>
  </>
}

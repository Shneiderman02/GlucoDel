import {useRef, useState, type FormEvent} from 'react'
import {ArrowLeft, Plus, Trash2} from 'lucide-react'
import {asNumber, atLocal, date, localInput, nutrients, labels, unit, number, type Meal, type Product, type Revision} from './model'
import {Nutrition} from './ui'

type DraftProduct = {id: string; name: string; grams: string; protein: string; fat: string; carbs: string; energy: string}
const blank = (id: string): DraftProduct => ({id, name: '', grams: '', protein: '', fat: '', carbs: '', energy: ''})
const toDraft = (product: Product): DraftProduct => ({
  id: product.id, name: product.name, grams: String(product.grams), protein: String(product.protein ?? ''),
  fat: String(product.fat ?? ''), carbs: String(product.carbs ?? ''), energy: String(product.energy ?? ''),
})

export function MealForm({meal, versions, onSave, onCancel, latest}: {
  meal?: Meal; versions: Revision[]; onSave: (meal: Meal) => Promise<void>; onCancel: () => void; latest: number;
}) {
  const [title, setTitle] = useState(meal?.title ?? '')
  const [when, setWhen] = useState(localInput(meal?.at ?? latest))
  const [products, setProducts] = useState<DraftProduct[]>(() => meal?.products.map(toDraft) ?? [blank('p1')])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [storageError, setStorageError] = useState('')
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const toProduct = (product: DraftProduct): Product => ({
    id: product.id, name: product.name.trim(), grams: asNumber(product.grams) ?? 0,
    protein: asNumber(product.protein), fat: asNumber(product.fat), carbs: asNumber(product.carbs), energy: asNumber(product.energy),
  })
  const update = (id: string, field: keyof DraftProduct, value: string) =>
    setProducts(current => current.map(product => product.id === id ? {...product, [field]: value} : product))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const nextErrors: Record<string, string> = {}
    if (!title.trim()) nextErrors.title = 'Укажите название приёма пищи.'
    if (!Number.isFinite(atLocal(when)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) nextErrors.when = 'Укажите дату и время.'
    products.forEach(draft => {
      const product = toProduct(draft)
      if (!product.name) nextErrors[draft.id + '-name'] = 'Укажите название продукта.'
      if (!Number.isFinite(product.grams) || product.grams <= 0) nextErrors[draft.id + '-grams'] = 'Масса должна быть больше нуля.'
      nutrients.forEach(key => {
        const value = product[key]
        if (value !== null && (!Number.isFinite(value) || value < 0)) nextErrors[draft.id + '-' + key] = 'Введите число от нуля или оставьте поле пустым.'
      })
    })
    setErrors(nextErrors)
    const firstError = Object.keys(nextErrors)[0]
    if (firstError) {
      form.querySelector<HTMLElement>('[id="' + firstError + '"]')?.focus()
      return
    }
    submitting.current = true
    setSaving(true)
    setStorageError('')
    try {
      await onSave({id: meal?.id ?? crypto.randomUUID(), title: title.trim(), at: atLocal(when), products: products.map(toProduct)})
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Не удалось сохранить запись.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  const errorProps = (id: string) => ({id, 'aria-invalid': Boolean(errors[id]), 'aria-describedby': errors[id] ? id + '-error' : undefined})
  const errorText = (id: string) => errors[id] && <small className="field-error" id={id + '-error'}>{errors[id]}</small>
  const preview = products.map(draft => {
      const product = toProduct(draft)
      if (!Number.isFinite(product.grams) || product.grams <= 0) return null
      const safe = {...product}
      nutrients.forEach(key => {if (safe[key] !== null && (!Number.isFinite(safe[key]) || safe[key] < 0)) safe[key] = null})
      return safe
    })
  return <div className="form-wrap">
    <button className="button quiet back" onClick={onCancel}><ArrowLeft size={17}/>К дневнику</button>
    <div className="page-intro"><h1>{meal ? 'Изменить запись' : 'Добавить еду'}</h1><p>Время по Москве · состав из расчёта на 100 г</p></div>
    <form noValidate className="panel entry-form" onSubmit={submit}>
      {Object.keys(errors).length > 0 && <p role="alert" className="field-error">Проверьте выделенные поля.</p>}
      {storageError && <p role="alert" className="field-error">{storageError}</p>}
      <div className="form-grid">
        <label htmlFor="title">Название приёма пищи<input {...errorProps('title')} value={title} required maxLength={100} onChange={e => setTitle(e.target.value)}/>{errorText('title')}</label>
        <label htmlFor="when">Дата и время<input {...errorProps('when')} value={when} required type="datetime-local" onChange={e => setWhen(e.target.value)}/>{errorText('when')}</label>
      </div>
      {products.map((product, index) => <fieldset key={product.id} className="product">
        <legend>Продукт {index + 1}</legend>
        {products.length > 1 && <button className="button quiet delete" aria-label={'Удалить продукт ' + (index + 1)} type="button" onClick={() => setProducts(current => current.filter(row => row.id !== product.id))}><Trash2 size={16}/></button>}
        <div className="form-grid">
          <label>Название продукта<input {...errorProps(product.id + '-name')} value={product.name} required maxLength={100} onChange={e => update(product.id, 'name', e.target.value)}/>{errorText(product.id + '-name')}</label>
          <label>Съеденная масса, г<input {...errorProps(product.id + '-grams')} type="number" step="any" required value={product.grams} onChange={e => update(product.id, 'grams', e.target.value)}/>{errorText(product.id + '-grams')}</label>
        </div>
        <div className="form-grid nutrient-fields">
          {nutrients.map(key => <label key={key}>{labels[key]}, {unit(key)} / 100 г
            <input {...errorProps(product.id + '-' + key)} type="number" step="any" min="0" value={product[key]} onChange={e => update(product.id, key, e.target.value)}/>
            {errorText(product.id + '-' + key)}
          </label>)}
        </div>
        {preview[index] && <div className="product-scale"><strong>На съеденную порцию</strong><Nutrition products={[preview[index]]}/></div>}
      </fieldset>)}
      <button type="button" className="button secondary" onClick={() => {
        const id = crypto.randomUUID()
        setProducts(current => [...current, blank(id)])
      }}><Plus size={17}/>Добавить продукт</button>
      <section className="entry-total"><h2>Итого на порцию</h2>
        {preview.every(product => product !== null) ? <Nutrition products={preview}/> : <p className="muted">Укажите съеденную массу каждого продукта.</p>}
      </section>
      <div className="form-actions"><button type="submit" className="button primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить запись'}</button><button type="button" className="button quiet" onClick={onCancel}>Отмена</button></div>
    </form>
    {meal && <section className="panel revisions"><h2>История изменений</h2>
      {versions.length ? versions.map((revision, index) => <details key={index}><summary>Предыдущая версия {versions.length - index} · {revision.meal.title}</summary>
        <p>{date(revision.meal.at)} · {localInput(revision.meal.at).slice(11)} · {revision.meal.products.map(product => product.name + ' ' + number(product.grams) + ' г').join(', ')}</p>
        <Nutrition products={revision.meal.products}/>
        <ul className="plain-list">{revision.meal.products.map(product => <li key={product.id}>
          {product.name} · на 100 г · {nutrients.map(key => labels[key] + ' ' + (product[key] === null ? '—' : number(product[key])) + ' ' + unit(key)).join(' · ')}
        </li>)}</ul>
      </details>) : <p className="muted">Предыдущих версий пока нет.</p>}
    </section>}
  </div>
}

export type AiAssistantMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

const welcomeMessage: AiAssistantMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Здравствуйте! Я помогу разобраться с поиском помещений, просмотром, календарём и подготовкой КП.'
}

function assistantAnswer(question: string) {
  const value = question.toLocaleLowerCase('ru-RU')

  if (value.includes('добав') && value.includes('помещ')) {
    return 'Откройте «Поиск помещений» или «Помещения в работе» и нажмите «Добавить помещение». Заполните адрес и параметры объекта, затем сохраните карточку.'
  }
  if (value.includes('просмотр')) {
    return 'Откройте помещение в разделе «Помещения в работе», перейдите во вкладку «Сопровождение», укажите дату, время и ответственного, затем нажмите «Назначить».'
  }
  if (value.includes('кп') || value.includes('коммерческ')) {
    return 'Вкладка «КП» становится доступна после завершения просмотра и добавления фото и видео. Затем заполните коммерческие условия и нажмите «Подготовить КП».'
  }
  if (value.includes('календар')) {
    return 'Календарь находится на странице «Помещения в работе». В нём отображаются назначенные просмотры и задачи по связи с арендодателями.'
  }
  if (value.includes('парс') || value.includes('обнов')) {
    return 'На странице «Поиск помещений» нажмите «Обновить». После завершения подходящие объекты появятся в списке и на карте.'
  }
  if (value.includes('отказ') || value.includes('не подходит')) {
    return 'В карточке помещения во вкладке «Сопровождение» выберите причину отказа, добавьте комментарий и зафиксируйте решение.'
  }

  return 'Я могу подсказать, как добавить помещение, назначить просмотр, работать с календарём, обновить поиск или подготовить КП. Напишите, с каким этапом нужна помощь.'
}

export function useAiAssistant() {
  const isOpen = useState('ai-assistant-open', () => false)
  const messages = useState<AiAssistantMessage[]>('ai-assistant-messages', () => [welcomeMessage])

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function send(question: string) {
    const text = question.trim()
    if (!text) return
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    messages.value.push({ id: `user-${suffix}`, role: 'user', text })
    messages.value.push({ id: `assistant-${suffix}`, role: 'assistant', text: assistantAnswer(text) })
  }

  return { isOpen, messages, open, close, send }
}

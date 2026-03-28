import { useState, useCallback, useMemo, useEffect } from 'react'
import { addEntry, setTagColor, stripTags, isScheduledDate, UNSCHEDULED, type BujoEntry, type BujoStatus } from './db'
import { useTags, useEntriesForTag } from './hooks'
import TagPills from './TagPills'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '>',
  note: '–',
  event: '○',
}

const COLOR_PALETTE = [
  '#7aa2d4', '#d4a27a', '#b39ddb', '#4caf50', '#e57373',
  '#4dd0e1', '#fff176', '#a1887f', '#90a4ae', '#f48fb1',
  '#81c784', '#ffb74d', '#64b5f6', '#ba68c8', '#ef5350',
]

interface TagDetailProps {
  tagName: string
  tagColor: string
  onBack: () => void
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

function TagDetail({ tagName, tagColor, onBack, onOpenDetail, onTagClick }: TagDetailProps) {
  const entries = useEntriesForTag(tagName)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [currentColor, setCurrentColor] = useState(tagColor)
  const [newBody, setNewBody] = useState('')

  const handleColorChange = useCallback(async (color: string) => {
    await setTagColor(tagName, color)
    setCurrentColor(color)
    setShowColorPicker(false)
  }, [tagName])

  const handleAdd = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    // Auto-include the tag if not already present
    const body = trimmed.match(new RegExp(`#${tagName}\\b`, 'i')) ? trimmed : `${trimmed} #${tagName}`
    await addEntry(UNSCHEDULED, 'task', body)
    setNewBody('')
  }, [newBody, tagName])

  const sortedEntries = useMemo(() => {
    if (!entries) return undefined
    return [...entries].sort((a, b) => b.createdAt - a.createdAt)
  }, [entries])

  return (
    <div className="tag-detail">
      <header className="tag-detail-header">
        <button className="tag-back-btn" onClick={onBack}>&larr;</button>
        <span className="tag-pill-large" style={{ background: currentColor }}>
          #{tagName}
        </span>
        <button
          className="tag-color-btn"
          onClick={() => setShowColorPicker(!showColorPicker)}
          style={{ background: currentColor }}
          title="Change color"
        />
      </header>

      {showColorPicker && (
        <div className="tag-color-picker">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              className={`tag-color-swatch ${c === currentColor ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => handleColorChange(c)}
            />
          ))}
        </div>
      )}

      <div className="tag-entry-count">
        {entries === undefined ? '…' : `${entries.length} entries`}
      </div>

      {sortedEntries === undefined ? (
        <p className="loading">Loading…</p>
      ) : sortedEntries.length === 0 ? (
        <p className="empty">No entries with this tag.</p>
      ) : (
        <ul className="entry-list">
          {sortedEntries.map((entry) => (
            <li key={entry._id} className={`entry status-${entry.status}`}>
              <span className="signifier-static">
                {STATUS_ICONS[entry.status]}
              </span>
              <span className="tag-entry-date">
                {isScheduledDate(entry.date) ? entry.date : '—'}
              </span>
              <span
                className="body"
                onClick={() => onOpenDetail?.(entry)}
                style={{ cursor: onOpenDetail ? 'pointer' : undefined }}
              >
                {stripTags(entry.body)}
                <TagPills tags={entry.tags?.filter((t) => t !== tagName)} small onTagClick={onTagClick} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="new-entry tag-new-entry"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <input
          type="text"
          placeholder={`New task in #${tagName}…`}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}

interface Props {
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
  initialTag?: string | null
  onClearInitialTag?: () => void
}

export default function TagView({ onOpenDetail, onTagClick, initialTag, onClearInitialTag }: Props) {
  const tags = useTags()
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null)

  useEffect(() => {
    if (initialTag) {
      setSelectedTag(initialTag)
      onClearInitialTag?.()
    }
  }, [initialTag, onClearInitialTag])

  const selectedTagDoc = useMemo(
    () => tags?.find((t) => t.name === selectedTag),
    [tags, selectedTag],
  )

  if (selectedTag && selectedTagDoc) {
    return (
      <TagDetail
        tagName={selectedTag}
        tagColor={selectedTagDoc.color}
        onBack={() => setSelectedTag(null)}
        onOpenDetail={onOpenDetail}
        onTagClick={(name) => {
          setSelectedTag(name)
          onTagClick?.(name)
        }}
      />
    )
  }

  return (
    <div className="tag-view">
      <h2 className="tag-view-title">Collections</h2>
      {tags === undefined ? (
        <p className="loading">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="empty">No tags yet. Add #tags to your entries to create collections.</p>
      ) : (
        <div className="tag-grid">
          {tags.map((tag) => (
            <button
              key={tag.name}
              className="tag-card"
              onClick={() => setSelectedTag(tag.name)}
            >
              <span className="tag-card-color" style={{ background: tag.color }} />
              <span className="tag-card-name">#{tag.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

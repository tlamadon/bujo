import { useContext, useState } from 'react'
import { addEntry, setTagColor, UNSCHEDULED, type BujoEntry } from './db'
import Composer from './Composer'
import EditableEntry from './EditableEntry'
import { formatDateCompact } from './format'
import { useEntriesForTag, useTags } from './hooks'
import { ChevronLeft } from './Icons'
import { navigate, routeHash } from './router'
import { entryClass } from './statusMeta'
import { FALLBACK_TAG_COLOR, TagColorsContext, readableTextColor } from './tagColors'
import { showError } from './toast'
import { useStableList } from './useStableList'

const COLOR_PALETTE = [
  '#7aa2d4', '#d4a27a', '#b39ddb', '#4caf50', '#e57373',
  '#4dd0e1', '#fff176', '#a1887f', '#90a4ae', '#f48fb1',
  '#81c784', '#ffb74d', '#64b5f6', '#ba68c8', '#ef5350',
]

const entryId = (entry: BujoEntry) => entry._id
const newestFirst = (a: BujoEntry, b: BujoEntry) => b.createdAt - a.createdAt

interface TagDetailProps {
  tagName: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

function TagDetail({ tagName, onOpenDetail, onTagClick }: TagDetailProps) {
  const color = useContext(TagColorsContext).get(tagName) ?? FALLBACK_TAG_COLOR
  const entries = useStableList(useEntriesForTag(tagName), {
    id: entryId,
    compare: newestFirst,
    resetKey: tagName,
  })
  const [showColorPicker, setShowColorPicker] = useState(false)

  const pickColor = async (next: string) => {
    setShowColorPicker(false)
    try {
      await setTagColor(tagName, next)
    } catch (err) {
      showError(err)
    }
  }

  const handleAdd = (body: string) => {
    // Auto-include the tag if not already present
    const tagged = new RegExp(`#${tagName}(?![a-zA-Z0-9_-])`, 'i').test(body) ? body : `${body} #${tagName}`
    return addEntry(UNSCHEDULED, 'task', tagged)
  }

  return (
    <div className="tag-detail">
      <header className="tag-detail-header">
        <button
          type="button"
          className="icon-btn"
          onClick={() => navigate({ view: 'tags', tag: null })}
          aria-label="All tags"
          title="All tags"
        >
          <ChevronLeft />
        </button>
        <h2 className="tag-pill tag-pill-large" style={{ background: color, color: readableTextColor(color) }}>
          #{tagName}
        </h2>
        <span className="tag-entry-count">
          {entries === undefined ? '' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
        </span>
        <button
          type="button"
          className="tag-color-btn"
          onClick={() => setShowColorPicker(!showColorPicker)}
          aria-label="Change color"
          aria-expanded={showColorPicker}
          title="Change color"
        >
          <span style={{ background: color }} />
        </button>
      </header>

      {showColorPicker && (
        <div className="tag-color-picker" role="group" aria-label="Tag color">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`tag-color-swatch ${c === color ? 'active' : ''}`}
              onClick={() => pickColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={c === color}
            >
              <span style={{ background: c }} />
            </button>
          ))}
        </div>
      )}

      {entries === undefined ? (
        <p className="loading">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="empty">No entries with this tag.</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry._id} className={`entry ${entryClass(entry)}`}>
              <EditableEntry
                entry={entry}
                meta={formatDateCompact(entry.date)}
                hideTag={tagName}
                onOpenDetail={onOpenDetail}
                onTagClick={onTagClick}
              />
            </li>
          ))}
        </ul>
      )}

      <Composer placeholder={`New task in #${tagName}…`} onAdd={(_status, body) => handleAdd(body)} />
    </div>
  )
}

interface Props {
  /** The tag to show, or null for the list of all tags */
  tag: string | null
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function TagView({ tag, onOpenDetail, onTagClick }: Props) {
  const tags = useTags()

  if (tag) {
    // Keyed by tag, so moving from one tag to another starts clean
    return <TagDetail key={tag} tagName={tag} onOpenDetail={onOpenDetail} onTagClick={onTagClick} />
  }

  return (
    <div className="tag-view">
      <header className="view-header">
        <h2>Collections</h2>
        <p>Everything sharing a #tag, across all days.</p>
      </header>
      {tags === undefined ? (
        <p className="loading">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="empty">No tags yet. Add #tags to your entries to create collections.</p>
      ) : (
        <div className="tag-grid">
          {tags.map((t) => (
            <a key={t.name} className="tag-card" href={routeHash({ view: 'tags', tag: t.name })}>
              <span className="tag-card-color" style={{ background: t.color }} />
              <span className="tag-card-name">#{t.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

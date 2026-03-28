import { useTags } from './hooks'

interface Props {
  tags?: string[]
  small?: boolean
  onTagClick?: (tagName: string) => void
}

export default function TagPills({ tags, small, onTagClick }: Props) {
  const allTags = useTags()
  if (!tags || tags.length === 0 || !allTags) return null

  const tagMap = new Map(allTags.map((t) => [t.name, t.color]))

  return (
    <span className={`tag-pills ${small ? 'tag-pills-small' : ''}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={`tag-pill ${onTagClick ? 'tag-pill-clickable' : ''}`}
          style={{ background: tagMap.get(tag) || '#555' }}
          onClick={onTagClick ? (e) => { e.stopPropagation(); onTagClick(tag) } : undefined}
        >
          #{tag}
        </span>
      ))}
    </span>
  )
}

import { useContext } from 'react'
import { FALLBACK_TAG_COLOR, TagColorsContext, readableTextColor } from './tagColors'

interface Props {
  tags?: string[]
  onTagClick?: (tagName: string) => void
}

export default function TagPills({ tags, onTagClick }: Props) {
  const colors = useContext(TagColorsContext)
  if (!tags || tags.length === 0) return null

  return (
    <span className="tag-pills">
      {tags.map((tag) => {
        const background = colors.get(tag) ?? FALLBACK_TAG_COLOR
        const style = { background, color: readableTextColor(background) }
        return onTagClick ? (
          <button
            key={tag}
            type="button"
            className="tag-pill"
            style={style}
            onClick={() => onTagClick(tag)}
            title={`Show everything tagged #${tag}`}
          >
            #{tag}
          </button>
        ) : (
          <span key={tag} className="tag-pill" style={style}>
            #{tag}
          </span>
        )
      })}
    </span>
  )
}

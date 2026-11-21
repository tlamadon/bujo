import { describe, expect, it } from 'vitest'
import { parseTags, stripTags } from '../src'
import { dump, newBujo } from './helpers'

describe('tag parsing', () => {
  it('extracts lowercase, deduplicated tags', () => {
    expect(parseTags('Fix sink #House #diy and #house again')).toEqual(['house', 'diy'])
  })

  it('accepts digits, dashes and underscores', () => {
    expect(parseTags('#q4-2026 #side_project #a1')).toEqual(['q4-2026', 'side_project', 'a1'])
  })

  it('returns an empty list when there are no tags', () => {
    expect(parseTags('nothing here')).toEqual([])
    expect(parseTags('')).toEqual([])
    expect(parseTags('a lone # sign')).toEqual([])
  })

  it('strips tags and collapses the whitespace they leave behind', () => {
    expect(stripTags('Fix #house sink #diy')).toBe('Fix sink')
    expect(stripTags('#solo')).toBe('')
    expect(stripTags('no tags')).toBe('no tags')
  })
})

describe('tag docs', () => {
  it('creates a tag doc with a default color the first time a tag is used', async () => {
    const { db, bujo } = newBujo()
    await bujo.addEntry('2026-11-21', 'task', 'Fix sink #house')
    await bujo.addEntry('2026-11-21', 'task', 'Paint fence #house #garden')

    const { tags } = await dump(db)
    expect(tags.map((t) => t._id)).toEqual(['tag:garden', 'tag:house'])
    const house = await bujo.getTag('house')
    expect(house?.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('stores tags on the entry and keeps them in sync with the body', async () => {
    const { bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'Fix sink #house')
    expect(entry.tags).toEqual(['house'])

    const retagged = await bujo.updateEntry(entry, { body: 'Fix sink #diy' })
    expect(retagged.tags).toEqual(['diy'])

    const untagged = await bujo.updateEntry(retagged, { body: 'Fix sink' })
    expect(untagged.tags).toBeUndefined()
  })

  it('finds entries by tag, case-insensitively', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-21', 'task', 'Fix sink #house')
    await bujo.addEntry('2026-11-22', 'note', 'Boiler serviced #House')
    await bujo.addEntry('2026-11-22', 'task', 'Unrelated #work')

    const found = await bujo.getEntriesForTag('HOUSE')
    expect(found.map((e) => e.body).sort()).toEqual(['Boiler serviced #House', 'Fix sink #house'])
  })

  it('changes a tag color, creating the tag doc if needed', async () => {
    const { bujo } = newBujo()
    await bujo.setTagColor('New', '#123456')
    expect((await bujo.getTag('new'))?.color).toBe('#123456')
    await bujo.setTagColor('new', '#654321')
    expect((await bujo.getTag('new'))?.color).toBe('#654321')
    expect(await bujo.getAllTags()).toHaveLength(1)
  })
})

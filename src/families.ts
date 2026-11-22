import { createContext } from 'react'
import { NO_FAMILIES, type FamilyIndex } from './db'

/**
 * Who is a subtask of whom, across the whole journal. Loaded once at the top
 * of the app: an epic and its subtasks are usually on different days, so no
 * single view has both.
 */
export const FamiliesContext = createContext<FamilyIndex>(NO_FAMILIES)

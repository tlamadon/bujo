// A single transient message at the bottom of the screen, optionally with one
// action (in practice: Undo). A new toast replaces the current one.

import { useSyncExternalStore } from 'react'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface Toast {
  id: number
  message: string
  action?: ToastAction
}

const PLAIN_MS = 4000
const ACTION_MS = 8000

let current: Toast | null = null
let timer: number | undefined
let nextId = 1
const listeners = new Set<() => void>()

function set(toast: Toast | null): void {
  current = toast
  window.clearTimeout(timer)
  if (toast) timer = window.setTimeout(() => set(null), toast.action ? ACTION_MS : PLAIN_MS)
  listeners.forEach((l) => l())
}

export function showToast(message: string, action?: ToastAction): void {
  set({ id: nextId++, message, action })
}

export function dismissToast(): void {
  set(null)
}

/** Report a failed action instead of letting the rejection vanish. */
export function showError(err: unknown): void {
  showToast(err instanceof Error && err.message ? err.message : 'Something went wrong')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToast(): Toast | null {
  return useSyncExternalStore(subscribe, () => current)
}

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Fusionne des classes Tailwind en laissant la derniere gagner sur les conflits. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

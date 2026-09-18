import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import { Input } from './input.js'
import { Label } from './label.js'
import { cn } from '../lib/utils.js'

interface FieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  label: string
  /** Message d'erreur : relie au champ par `aria-describedby`. */
  error?: string | undefined
  hint?: ReactNode
}

/**
 * Champ de formulaire accessible : libelle lie, aide et erreur annoncees, etat
 * invalide expose aux technologies d'assistance.
 */
export function Field({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(className)}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}

import { GenericObject } from './types'

// wraps value in closure or returns closure
export const closure = (
  value: GenericObject | (() => GenericObject)
): (() => GenericObject) => {
  return typeof value === 'function' ? value : () => value
}

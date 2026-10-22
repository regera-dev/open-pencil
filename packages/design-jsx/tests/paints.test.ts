import { describe, expect, test } from 'bun:test'

import { linearGradient, radialGradient } from '@open-pencil/design-jsx'
import { DEFAULT_GRADIENT_TRANSFORM } from '@open-pencil/scene-graph/gradient'

const expected =
  "linearGradient() expects an array of stops, such as [['#3b82f6', 0], ['#8b5cf6', 1]]"

const stops: [string, number][] = [
  ['#3b82f6', 0],
  ['#8b5cf6', 1]
]

describe('gradient helpers', () => {
  test("store a transform given as Figma's rows in the scene graph's form", () => {
    const fill = linearGradient(stops, {
      transform: [
        [0, 1, 0],
        [-1, 0, 1]
      ]
    })
    expect(fill.gradientTransform).toEqual(DEFAULT_GRADIENT_TRANSFORM)
  })

  test('keep a transform given in the scene graph form', () => {
    const transform = { m00: 2, m01: 0, m02: -0.5, m10: 0, m11: 1, m12: 0.2 }
    expect(linearGradient(stops, { transform }).gradientTransform).toEqual(transform)
  })

  test('say what a transform may be when it is neither', () => {
    expect(() => linearGradient(stops, { transform: [[0, 1, 0]] as never })).toThrow(
      "linearGradient() expects a transform as { m00, m01, m02, m10, m11, m12 } or Figma's [[a, b, c], [d, e, f]], such as [[0, 1, 0], [-1, 0, 1]]:\n× Expected { m00, m01, m02, m10, m11, m12 } or [[a, b, c], [d, e, f]] but received Array"
    )
  })

  test('accept tuple and object stops', () => {
    const fill = linearGradient([['#000000', 0], { color: '#ffffff', position: 1 }])
    expect(fill.gradientStops?.map((stop) => stop.position)).toEqual([0, 1])
  })

  const circular: Record<string, unknown> = {}
  circular.self = circular

  test.each([
    ['#3b82f6', '"#3b82f6"'],
    [{ stops: [] }, 'Object'],
    [undefined, 'undefined'],
    [10n, '10'],
    [circular, 'Object']
  ])('say what they expect when the stops are not an array (%p)', (stops, received) => {
    expect(() => linearGradient(stops as never)).toThrow(
      `${expected}:\n× Invalid type: Expected Array but received ${received}`
    )
  })

  test('name the stop that is wrong and what it was', () => {
    expect(() => radialGradient([['#000000', 0], ['#ffffff']] as never)).toThrow(
      "radialGradient() expects an array of stops, such as [['#3b82f6', 0], ['#8b5cf6', 1]]:\n× Expected [color, position] or { color, position } but received Array\n  → at 1"
    )
  })
})

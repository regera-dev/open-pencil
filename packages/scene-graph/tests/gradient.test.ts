import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import {
  DEFAULT_GRADIENT_TRANSFORM,
  IDENTITY_GRADIENT_TRANSFORM,
  defaultGradientStops,
  ellipticalGradientTransform,
  gradientPoint,
  gradientTransformSchema,
  invertGradientTransform,
  linearGradientTransform
} from '@open-pencil/scene-graph/gradient'
import type { GradientTransform } from '@open-pencil/scene-graph'

function values(t: GradientTransform) {
  return [t.m00, t.m01, t.m02, t.m10, t.m11, t.m12].map((v) => +v.toFixed(6) + 0)
}

describe('gradient paints in Figma convention', () => {
  test('the identity runs from the left edge middle to the right edge middle', () => {
    expect(gradientPoint(IDENTITY_GRADIENT_TRANSFORM, { x: 0, y: 0.5 })).toEqual({ x: 0, y: 0.5 })
    expect(gradientPoint(IDENTITY_GRADIENT_TRANSFORM, { x: 1, y: 0.5 })).toEqual({ x: 1, y: 0.5 })
  })

  // Figma desktop 126 gives a fill switched to Linear this transform: top to bottom.
  test("Figma's default runs top to bottom", () => {
    expect(values(linearGradientTransform({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }))).toEqual(
      values(DEFAULT_GRADIENT_TRANSFORM)
    )
    expect(gradientPoint(DEFAULT_GRADIENT_TRANSFORM, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  test('a transform and its inverse undo each other', () => {
    const t = { m00: 2, m01: 0.3, m02: -0.2, m10: -0.4, m11: 1.5, m12: 0.1 }
    const back = invertGradientTransform(invertGradientTransform(t))
    expect(values(back)).toEqual(values(t))
  })

  test('an elliptical gradient is centred where its centre was given', () => {
    const t = ellipticalGradientTransform({ x: 0.35, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.35, y: 0.73 })
    const center = gradientPoint(t, { x: 0.5, y: 0.5 })
    expect(center.x).toBeCloseTo(0.35, 6)
    expect(center.y).toBeCloseTo(0.4, 6)
    expect(gradientPoint(t, { x: 1, y: 0.5 }).x).toBeCloseTo(0.6, 6)
  })

  // Figma desktop 126 turns FF4D33 into a gradient to 992E1F.
  test('a new gradient runs from the fill colour to a 60% shade of it', () => {
    const [first, second] = defaultGradientStops({ r: 1, g: 0x4d / 255, b: 0x33 / 255, a: 1 })
    expect(first?.position).toBe(0)
    const hex = [second?.color.r, second?.color.g, second?.color.b].map((c) =>
      Math.round((c ?? 0) * 255)
    )
    expect(hex).toEqual([0x99, 0x2e, 0x1f])
  })
})

// Figma's plugin API writes a Transform as two rows, [[m00, m01, m02], [m10, m11, m12]], the way
// relativeTransform reads back; its default gradient is [[0, 1, 0], [-1, 0, 1]].
describe('a gradient transform read from a script', () => {
  test("maps Figma's rows onto the matrix fields", () => {
    const rows = [
      [0, 1, 0],
      [-1, 0, 1]
    ]
    expect(v.parse(gradientTransformSchema, rows)).toEqual(DEFAULT_GRADIENT_TRANSFORM)
  })

  test('keeps the matrix fields and drops any other', () => {
    const t = { m00: 2, m01: 0.3, m02: -0.2, m10: -0.4, m11: 1.5, m12: 0.1 }
    expect(v.parse(gradientTransformSchema, { ...t, extra: 1 })).toEqual(t)
  })

  test.each([
    ['a string', 'x'],
    ['one row', [[0, 1, 0]]],
    [
      'a short row',
      [
        [0, 1],
        [-1, 0, 1]
      ]
    ],
    ['a missing field', { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1 }],
    ['a field that is not a number', { ...IDENTITY_GRADIENT_TRANSFORM, m02: '0' }],
    ['NaN', { ...IDENTITY_GRADIENT_TRANSFORM, m02: Number.NaN }],
    [
      'Infinity',
      [
        [Number.POSITIVE_INFINITY, 0, 0],
        [0, 1, 0]
      ]
    ]
  ])('refuses %s', (_, value) => {
    expect(v.safeParse(gradientTransformSchema, value).success).toBe(false)
  })
})

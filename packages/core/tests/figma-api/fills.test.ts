import { describe, expect, test } from 'bun:test'

import { expectFills } from '#core-tests/helpers/assert'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'
import { DEFAULT_GRADIENT_TRANSFORM } from '@open-pencil/scene-graph/gradient'

const RED = { r: 1, g: 0, b: 0 }
const BLUE = { r: 0, g: 0, b: 1 }

/** A gradient paint as a plugin script writes it, with Figma's `Transform` rows. */
function gradient(gradientTransform: unknown) {
  return {
    type: 'GRADIENT_LINEAR',
    gradientStops: [
      { position: 0, color: RED },
      { position: 1, color: BLUE }
    ],
    gradientTransform
  }
}

const rows = [
  [0, 1, 0],
  [-1, 0, 1]
]

function createRectangle() {
  return new FigmaAPI(new SceneGraph()).createRectangle()
}

// A script is untyped, so the setters check what they receive at runtime.
describe('gradient paints a script assigns', () => {
  test("fills store Figma's transform rows in the scene graph's form", () => {
    const rect = createRectangle()
    Reflect.set(rect, 'fills', [gradient(rows)])
    expect(expectFills(rect.fills)[0]).toMatchObject({
      gradientTransform: DEFAULT_GRADIENT_TRANSFORM
    })
  })

  test("strokes store Figma's transform rows in the scene graph's form", () => {
    const rect = createRectangle()
    Reflect.set(rect, 'strokes', [gradient(rows)])
    expect(rect.strokes[0]).toMatchObject({ gradientTransform: DEFAULT_GRADIENT_TRANSFORM })
  })

  test("fills keep a transform already in the scene graph's form", () => {
    const rect = createRectangle()
    const transform = { m00: 2, m01: 0, m02: -0.5, m10: 0, m11: 1, m12: 0.2 }
    Reflect.set(rect, 'fills', [gradient(transform)])
    expect(expectFills(rect.fills)[0]).toMatchObject({ gradientTransform: transform })
  })

  test('a transform that is neither is refused and the paint named', () => {
    const rect = createRectangle()
    expect(() => Reflect.set(rect, 'fills', [gradient({}), gradient('x')])).toThrow(
      'Property "fills" failed validation: Expected { m00, m01, m02, m10, m11, m12 } or [[a, b, c], [d, e, f]] but received Object at [0].gradientTransform'
    )
    expect(() => Reflect.set(rect, 'strokes', [gradient([[0, 1, 0]])])).toThrow(
      'Property "strokes" failed validation: Expected { m00, m01, m02, m10, m11, m12 } or [[a, b, c], [d, e, f]] but received Array at [0].gradientTransform'
    )
    expect(expectFills(rect.fills)).toHaveLength(1)
    expect(rect.strokes).toHaveLength(0)
  })
})

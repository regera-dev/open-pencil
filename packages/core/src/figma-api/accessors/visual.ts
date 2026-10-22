import * as v from 'valibot'

import {
  newStrokeGeometry,
  resolvedPaintBindings,
  type Color,
  type Fill,
  type GradientStop,
  type GradientTransform,
  type SceneNode,
  type Stroke
} from '@open-pencil/scene-graph'
import { normalizeColor } from '@open-pencil/scene-graph/color'
import { copyFills, copyStrokes } from '@open-pencil/scene-graph/copy'
import {
  gradientTransformSchema,
  type GradientTransformInput
} from '@open-pencil/scene-graph/gradient'

import {
  graph,
  raw,
  strokeOwner,
  updateNode,
  type NodeProxyInternals,
  type ProxyThis
} from '#core/figma-api/accessor-utils'
import {
  issuePath,
  parseFigmaEffects,
  toFigmaEffect,
  type FigmaEffect
} from '#core/figma-api/effects'
import { getTextStyle } from '#core/figma-api/text/style'
import {
  paintBindings,
  setPaintBindings,
  withPaintBinding
} from '#core/figma-api/variables/bindings'
import type { FigmaVariableAlias } from '#core/figma-api/variables/values'
import { textStyleChanges } from '#core/text/character-style'

function styleReference(
  internals: NodeProxyInternals,
  field: 'fillStyleId' | 'strokeStyleId' | 'effectStyleId' | 'gridStyleId',
  mixed: symbol
): PropertyDescriptor {
  return {
    get(this: ProxyThis): string | symbol {
      const node = raw(this, internals)
      // Characters of a text can each use a fill style of their own.
      if (field === 'fillStyleId' && node.type === 'TEXT') {
        return getTextStyle(node, 'fillStyleId', mixed) as string | symbol
      }
      return node[field] ?? ''
    },
    set(this: ProxyThis, value: string) {
      const node = raw(this, internals)
      const changes = { [field]: value || null }
      updateNode(
        this,
        internals,
        field === 'fillStyleId' && node.type === 'TEXT' ? textStyleChanges(node, changes) : changes
      )
    }
  }
}

/** Figma treats a paint's `opacity` and `visible` as optional, defaulting to 1 and `true`. */
function paintDefaults(paint: Partial<Pick<Fill, 'opacity' | 'visible'>>) {
  return { opacity: paint.opacity ?? 1, visible: paint.visible ?? true }
}

/** A colour as Figma's plugin API takes it, RGB with an optional alpha. */
type FigmaColor = Omit<Color, 'a'> & Partial<Pick<Color, 'a'>>

/**
 * A paint as Figma's plugin API takes it: RGB colours, optional opacity and visibility, a
 * gradient transform as the matrix fields or as the API's `Transform` rows, and the variable its
 * colour is bound to.
 */
export type FigmaPaint = Omit<
  Fill,
  'color' | 'opacity' | 'visible' | 'gradientStops' | 'gradientTransform'
> &
  Partial<Pick<Fill, 'opacity' | 'visible'>> & {
    color?: FigmaColor
    gradientStops?: Array<Omit<GradientStop, 'color'> & { color: FigmaColor }>
    gradientTransform?: GradientTransformInput
    boundVariables?: { color?: FigmaVariableAlias }
  }

/** A stroke as Figma's plugin API takes it: a paint, with the geometry fields optional. */
type FigmaStrokePaint = FigmaPaint & Partial<Omit<Stroke, keyof Fill>>

function parseGradientTransform(
  value: unknown,
  property: string,
  index: number
): GradientTransform {
  const result = v.safeParse(gradientTransformSchema, value)
  if (result.success) return result.output
  const [issue] = result.issues
  throw new Error(
    `Property "${property}" failed validation: ${issue.message} at [${index}].gradientTransform${issuePath(issue)}`
  )
}

/**
 * `fill` as the scene graph stores it. `property` and `index` name the paint when a value is
 * refused, as Figma's setters do: `Property "fills" failed validation: … at [0].gradientTransform`.
 */
export function figmaPaintToFill(
  { boundVariables: _bound, ...fill }: FigmaPaint,
  property: string,
  index: number
): Fill {
  return {
    ...fill,
    ...paintDefaults(fill),
    color: normalizeColor(fill.color),
    gradientStops: fill.gradientStops?.map((stop) => ({
      ...stop,
      color: normalizeColor(stop.color)
    })),
    gradientTransform:
      fill.gradientTransform === undefined
        ? undefined
        : parseGradientTransform(fill.gradientTransform, property, index)
  }
}

export function installVisualNodeProxyAccessors(
  prototype: object,
  internals: NodeProxyInternals,
  mixed: symbol
): void {
  Object.defineProperties(prototype, {
    fills: {
      // Text reads mixed while its characters are filled differently, and setting it fills them all.
      get(this: ProxyThis): readonly Fill[] | symbol {
        const node = raw(this, internals)
        if (node.type !== 'TEXT') {
          const bound = paintBindings(node, 'fills')
          const fills = bound.size
            ? (resolvedPaintBindings(graph(this, internals), node).fills ?? node.fills)
            : node.fills
          return Object.freeze(
            copyFills(fills).map((fill, index) => withPaintBinding(fill, bound.get(index)))
          )
        }
        const fills = getTextStyle(node, 'fills', mixed)
        return typeof fills === 'symbol' ? fills : Object.freeze(fills as Fill[])
      },
      set(this: ProxyThis, value: readonly FigmaPaint[]) {
        const node = raw(this, internals)
        const fills = value.map((paint, index) => figmaPaintToFill(paint, 'fills', index))
        updateNode(
          this,
          internals,
          node.type === 'TEXT' ? textStyleChanges(node, { fills }) : { fills }
        )
        setPaintBindings(graph(this, internals), raw(this, internals), 'fills', value)
      }
    },
    strokes: {
      get(this: ProxyThis): readonly Stroke[] {
        const owner = raw(strokeOwner(this, internals), internals)
        const bound = paintBindings(owner, 'strokes')
        const strokes = bound.size
          ? (resolvedPaintBindings(graph(this, internals), owner).strokes ?? owner.strokes)
          : owner.strokes
        return Object.freeze(
          copyStrokes(strokes).map((stroke, index) => withPaintBinding(stroke, bound.get(index)))
        )
      },
      // Figma paints carry no geometry; a stroke takes the node's weight and alignment, which
      // outlast its strokes.
      set(this: ProxyThis, value: readonly FigmaStrokePaint[]) {
        const owner = strokeOwner(this, internals)
        const geometry = newStrokeGeometry(raw(owner, internals))
        // The script keeps its paint objects; the node gets its own copies of every nested value.
        const strokes = copyStrokes(
          value.map((stroke, index) => ({
            ...figmaPaintToFill(stroke, 'strokes', index),
            weight: stroke.weight ?? geometry.weight,
            align: stroke.align ?? geometry.align
          }))
        )
        const kept = newStrokeGeometry({
          strokes,
          strokeWeight: geometry.weight,
          strokeAlign: geometry.align
        })
        updateNode(owner, internals, {
          strokes,
          strokeWeight: kept.weight,
          strokeAlign: kept.align
        })
        setPaintBindings(graph(this, internals), raw(owner, internals), 'strokes', value)
      }
    },
    effects: {
      get(this: ProxyThis): readonly FigmaEffect[] {
        return Object.freeze(raw(this, internals).effects.map(toFigmaEffect))
      },
      set(this: ProxyThis, value: readonly FigmaEffect[]) {
        updateNode(this, internals, { effects: parseFigmaEffects(value) })
      }
    },
    // Applied shared styles, as Figma exposes them; an assignment inside an instance is an override.
    fillStyleId: styleReference(internals, 'fillStyleId', mixed),
    strokeStyleId: styleReference(internals, 'strokeStyleId', mixed),
    effectStyleId: styleReference(internals, 'effectStyleId', mixed),
    gridStyleId: styleReference(internals, 'gridStyleId', mixed),
    opacity: {
      get(this: ProxyThis): number {
        return raw(this, internals).opacity
      },
      set(this: ProxyThis, value: number) {
        updateNode(this, internals, { opacity: value })
      }
    },
    visible: {
      get(this: ProxyThis): boolean {
        return raw(this, internals).visible
      },
      set(this: ProxyThis, value: boolean) {
        updateNode(this, internals, { visible: value })
      }
    },
    locked: {
      get(this: ProxyThis): boolean {
        return raw(this, internals).locked
      },
      set(this: ProxyThis, value: boolean) {
        updateNode(this, internals, { locked: value })
      }
    },
    blendMode: {
      get(this: ProxyThis): string {
        return raw(this, internals).blendMode
      },
      set(this: ProxyThis, value: string) {
        updateNode(this, internals, { blendMode: value as SceneNode['blendMode'] })
      }
    },
    clipsContent: {
      get(this: ProxyThis): boolean {
        return raw(this, internals).clipsContent
      },
      set(this: ProxyThis, value: boolean) {
        updateNode(this, internals, { clipsContent: value })
      }
    },
    cornerRadius: {
      get(this: ProxyThis): number | symbol {
        const node = raw(this, internals)
        if (node.independentCorners) return mixed
        return node.cornerRadius
      },
      set(this: ProxyThis, value: number | symbol) {
        if (value === mixed) return
        updateNode(this, internals, {
          cornerRadius: value as number,
          topLeftRadius: value as number,
          topRightRadius: value as number,
          bottomRightRadius: value as number,
          bottomLeftRadius: value as number,
          independentCorners: false
        })
      }
    },
    topLeftRadius: cornerAccessor(internals, 'topLeftRadius'),
    topRightRadius: cornerAccessor(internals, 'topRightRadius'),
    bottomLeftRadius: cornerAccessor(internals, 'bottomLeftRadius'),
    bottomRightRadius: cornerAccessor(internals, 'bottomRightRadius'),
    cornerSmoothing: {
      get(this: ProxyThis): number {
        return raw(this, internals).cornerSmoothing
      },
      set(this: ProxyThis, value: number) {
        updateNode(this, internals, { cornerSmoothing: value })
      }
    }
  })
}

function cornerAccessor(
  internals: NodeProxyInternals,
  field: 'topLeftRadius' | 'topRightRadius' | 'bottomLeftRadius' | 'bottomRightRadius'
): PropertyDescriptor {
  return {
    get(this: ProxyThis): number {
      return raw(this, internals)[field]
    },
    set(this: ProxyThis, value: number) {
      updateNode(this, internals, { [field]: value, independentCorners: true })
    }
  }
}

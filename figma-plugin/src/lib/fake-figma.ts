/**
 * An in-memory stand-in for the Figma document: it applies a `SyncPlan` the same
 * way `code.ts` does through the plugin API. That keeps the tests honest about
 * what a plan means and lets them prove both directions — and idempotency —
 * without opening Figma.
 */

import type {
  CollectionWrite,
  FigmaCollectionSnapshot,
  FigmaResolvedType,
  FigmaSnapshot,
  FigmaValue,
  FigmaVariableSnapshot,
  PlannedValue,
  SyncPlan,
  VariableWrite,
} from './types.js'

/** What Figma calls the mode it creates together with a collection. */
const FIGMA_DEFAULT_MODE = 'Mode 1'

const figmaValue = (planned: PlannedValue, aliasId: string): FigmaValue => {
  if (planned.kind === 'alias') return { type: 'alias', id: aliasId }
  return { type: 'raw', value: planned.value }
}

export class FakeFigmaStore {
  private readonly collections: FigmaCollectionSnapshot[]
  private readonly variables: FigmaVariableSnapshot[]
  private counter = 0

  constructor(snapshot: FigmaSnapshot = { collections: [], variables: [] }) {
    this.collections = structuredClone(snapshot.collections)
    this.variables = structuredClone(snapshot.variables)
  }

  snapshot(): FigmaSnapshot {
    return structuredClone({ collections: this.collections, variables: this.variables })
  }

  collectionsNamed(name: string): FigmaCollectionSnapshot[] {
    return this.collections.filter((collection) => collection.name === name)
  }

  /** Live references, so a test can rename a variable the way a designer would. */
  variablesNamed(name: string): FigmaVariableSnapshot[] {
    return this.variables.filter((variable) => variable.name === name)
  }

  /** `figma.variables.createVariableCollection` — one default mode, like Figma. */
  addCollection(name: string, brandId?: string, modeNames: readonly string[] = [FIGMA_DEFAULT_MODE]): FigmaCollectionSnapshot {
    const id = this.nextId('VariableCollectionId')
    const modes = modeNames.map((modeName) => ({ id: this.nextId('Mode'), name: modeName }))
    const collection: FigmaCollectionSnapshot = {
      id,
      name,
      defaultModeId: modes[0]?.id ?? this.nextId('Mode'),
      modes,
      ...(brandId === undefined ? {} : { brandId }),
    }

    this.collections.push(collection)
    return collection
  }

  /** `figma.variables.createVariable`; a fresh variable has no scopes and no description. */
  addVariable(name: string, collectionId: string, resolvedType: FigmaResolvedType): FigmaVariableSnapshot {
    const variable: FigmaVariableSnapshot = {
      id: this.nextId('VariableID'),
      name,
      collectionId,
      resolvedType,
      description: '',
      scopes: [],
      codeSyntax: {},
      valuesByMode: {},
    }

    this.variables.push(variable)
    return variable
  }

  setValue(variableId: string, modeName: string, value: FigmaValue): void {
    const variable = this.variables.find((candidate) => candidate.id === variableId)
    const modeId = variable === undefined ? undefined : this.modeId(variable.collectionId, modeName)
    if (variable === undefined || modeId === undefined) throw new Error(`No variable "${variableId}" or mode "${modeName}" to set a value on.`)

    variable.valuesByMode[modeId] = value
  }

  apply(plan: SyncPlan): void {
    for (const write of plan.collections) this.applyCollection(write)
    // Names, types and literal values first: aliases need every variable to exist.
    for (const write of plan.variables) this.applyVariable(write, false)
    for (const write of plan.variables) this.applyVariable(write, true)

    for (const removal of plan.removals) {
      const index = this.variables.findIndex((variable) => variable.id === removal.variableId)
      if (index !== -1) this.variables.splice(index, 1)
    }
  }

  private applyCollection(write: CollectionWrite): void {
    const existing = write.collectionId === undefined ? undefined : this.collections.find((candidate) => candidate.id === write.collectionId)
    const collection = existing ?? this.addCollection(write.name, write.brandId)
    collection.name = write.name
    collection.brandId = write.brandId

    if (write.defaultModeName !== undefined) {
      const defaultMode = collection.modes.find((mode) => mode.id === collection.defaultModeId)
      if (defaultMode !== undefined) defaultMode.name = write.defaultModeName
    }

    for (const mode of write.addModes) collection.modes.push({ id: this.nextId('Mode'), name: mode.name })

    const removed = new Set(write.removeModes.map((mode) => mode.modeId))
    collection.modes = collection.modes.filter((mode) => !removed.has(mode.id))
  }

  private applyVariable(write: VariableWrite, aliasesOnly: boolean): void {
    const variable = this.variableFor(write)
    if (variable === undefined) throw new Error(`The plan updated "${write.name}" before it existed.`)

    for (const entry of write.values) {
      const modeId = this.modeId(variable.collectionId, entry.mode)
      if (modeId === undefined) throw new Error(`The plan used mode "${entry.mode}", which "${variable.name}" does not have.`)

      if (entry.value.kind === 'alias') {
        if (!aliasesOnly) continue
        const target = this.variableIdFor(entry.value.brandId, entry.value.name)
        if (target === undefined) throw new Error(`The alias on "${write.name}" points at missing "${entry.value.name}".`)
        variable.valuesByMode[modeId] = figmaValue(entry.value, target)
        continue
      }
      if (aliasesOnly) continue

      variable.valuesByMode[modeId] = figmaValue(entry.value, '')
    }

    if (aliasesOnly) return

    variable.name = write.name
    if (write.description !== undefined) variable.description = write.description
    if (write.scopes !== undefined) variable.scopes = [...write.scopes]
    if (write.codeSyntax !== undefined) variable.codeSyntax = { ...write.codeSyntax }
  }

  /** Figma cannot change a resolved type, so `recreate` replaces the variable. */
  private variableFor(write: VariableWrite): FigmaVariableSnapshot | undefined {
    const current = write.variableId === undefined ? undefined : this.variables.find((candidate) => candidate.id === write.variableId)
    if (write.recreate === true && current !== undefined) this.variables.splice(this.variables.indexOf(current), 1)
    if (write.recreate !== true && current !== undefined) return current

    const collection = this.collectionForBrand(write.brandId) ?? this.addCollection(write.brandId, write.brandId)
    const known = this.variables.find((candidate) => candidate.collectionId === collection.id && candidate.name === write.name)
    return known ?? this.addVariable(write.name, collection.id, write.resolvedType)
  }

  private collectionForBrand(brandId: string): FigmaCollectionSnapshot | undefined {
    return this.collections.find((collection) => collection.brandId === brandId)
  }

  private modeId(collectionId: string, modeName: string): string | undefined {
    const collection = this.collections.find((candidate) => candidate.id === collectionId)
    return collection?.modes.find((mode) => mode.name === modeName)?.id
  }

  private variableIdFor(brandId: string, name: string): string | undefined {
    const collection = this.collectionForBrand(brandId)
    return this.variables.find((variable) => variable.collectionId === collection?.id && variable.name === name)?.id
  }

  private nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}:${this.counter}`
  }
}

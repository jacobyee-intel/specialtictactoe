/**
 * Every live GPU-backed three.js resource the 3D view creates goes through a registry, so
 * disposing a scene is one call and a test can check that nothing was left behind.
 *
 * three.js dispatches a `dispose` event from `BufferGeometry`, `Material` and `InstancedMesh`
 * when they are disposed; the registry listens for it, so `live` counts what is actually still
 * alive rather than what we remembered to dispose.
 */
import type { BufferGeometry, EventDispatcher, InstancedMesh, Material } from 'three';

export type Tracked = BufferGeometry | Material | InstancedMesh;

export class ResourceRegistry {
  private readonly items = new Set<Tracked>();

  track<T extends Tracked>(resource: T): T {
    if (this.items.has(resource)) return resource;
    this.items.add(resource);
    const target = resource as unknown as EventDispatcher<{ dispose: object }>;
    const onDispose = () => {
      this.items.delete(resource);
      target.removeEventListener('dispose', onDispose);
    };
    target.addEventListener('dispose', onDispose);
    return resource;
  }

  /** Resources created and not yet disposed. */
  get live(): number {
    return this.items.size;
  }

  disposeAll(): void {
    for (const item of [...this.items]) item.dispose();
    this.items.clear();
  }
}

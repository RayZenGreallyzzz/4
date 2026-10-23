import * as THREE from 'three';

/**
 * Display-only X-ray. Never mutates source materials, skin weights, or model
 * geometry. Clones lightweight material objects and shares existing textures.
 * Can be disabled/restored before GLB/FBX export or model disposal.
 */
export class XRayView {
  constructor() {
    this.root = null;
    this.enabled = false;
    this.opacity = .28;
    this.originals = new Map();
    this.clones = new Map();
  }
  restore() {
    for (const [mesh, materials] of this.originals) mesh.material = materials;
    this.originals.clear();
    for (const clone of this.clones.values()) clone.dispose();
    this.clones.clear();
  }
  setRoot(root) {
    this.restore();
    this.root = root || null;
    if (this.enabled) this.apply();
  }
  setEnabled(enabled) {
    const desired = Boolean(enabled);
    if (desired === this.enabled) return;
    this.restore();
    this.enabled = desired;
    if (desired) this.apply();
  }
  setOpacity(percentage) {
    const v = Number(percentage);
    if (!Number.isFinite(v)) return;
    this.opacity = THREE.MathUtils.clamp(v / 100, .05, .9);
    for (const [source, clone] of this.clones) {
      clone.opacity = (source.opacity ?? 1) * this.opacity;
      clone.needsUpdate = true;
    }
  }
  apply() {
    if (!this.root || !this.enabled) return;
    this.root.traverse(node => {
      if (!node.isMesh || !node.material || this.originals.has(node)) return;
      const original = node.material;
      const ghost = material => {
        if (!material) return material;
        if (!this.clones.has(material)) {
          const clone = material.clone();
          clone.transparent = true;
          clone.depthWrite = false;
          clone.opacity = (material.opacity ?? 1) * this.opacity;
          clone.side = THREE.DoubleSide;
          clone.needsUpdate = true;
          this.clones.set(material, clone);
        }
        return this.clones.get(material);
      };
      this.originals.set(node, original);
      node.material = Array.isArray(original) ? original.map(ghost) : ghost(original);
    });
  }
}

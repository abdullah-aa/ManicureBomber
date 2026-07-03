import { Scene, StandardMaterial, Color3 } from '@babylonjs/core';

/**
 * Per-Scene cache of shared, frozen part materials for every projectile type
 * (Tomahawk, Iskander, defense missile, bomb), mirroring the BuildingAssets
 * pattern. Each projectile used to allocate 6-12 fresh StandardMaterials per
 * launch/drop — each one a scene-wide material-list change plus a later
 * disposal — even though the colors are constants. Nothing in the projectiles'
 * update/damage/explode paths ever writes to a part material (verified: the
 * only runtime material mutations in the game are the bomber's bay glow and
 * the launcher flash, both deliberately per-instance/unfrozen), so one frozen
 * instance per part type serves every projectile forever.
 *
 * freeze() skips Babylon's per-frame material dirty checks; writes to a frozen
 * material silently no-op, so these must never be reconfigured after creation.
 * Projectiles must NOT dispose these: mesh hierarchies go down with plain
 * dispose() (no disposeMaterialAndTextures) so the shared materials survive.
 */
export class MissileAssets {
  private static cache: WeakMap<Scene, MissileAssets> = new WeakMap();

  static get(scene: Scene): MissileAssets {
    let assets = MissileAssets.cache.get(scene);
    if (!assets) {
      assets = new MissileAssets(scene);
      MissileAssets.cache.set(scene, assets);
    }
    return assets;
  }

  private scene: Scene;
  private materials: Map<string, StandardMaterial> = new Map();

  private constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Build-once lookup: configure runs on first request, then the material is frozen and reused. */
  private material(name: string, configure: (m: StandardMaterial) => void): StandardMaterial {
    let m = this.materials.get(name);
    if (!m) {
      m = new StandardMaterial(name, this.scene);
      configure(m);
      m.freeze();
      this.materials.set(name, m);
    }
    return m;
  }

  // --- Tomahawk ---

  getTomahawkFuselageMaterial(): StandardMaterial {
    return this.material('sharedTomahawkFuselage', (m) => {
      m.diffuseColor = new Color3(0.8, 0.8, 0.9); // Light gray
      m.specularColor = new Color3(0.5, 0.5, 0.6);
      m.emissiveColor = new Color3(0.1, 0.1, 0.12);
    });
  }

  getTomahawkNoseMaterial(): StandardMaterial {
    return this.material('sharedTomahawkNose', (m) => {
      m.diffuseColor = new Color3(0.2, 0.2, 0.25);
      m.specularColor = new Color3(0.8, 0.8, 0.9);
    });
  }

  getTomahawkEngineMaterial(): StandardMaterial {
    return this.material('sharedTomahawkEngine', (m) => {
      m.diffuseColor = new Color3(0.1, 0.1, 0.1);
      m.emissiveColor = new Color3(0.3, 0.1, 0.05);
    });
  }

  getTomahawkWingMaterial(): StandardMaterial {
    return this.material('sharedTomahawkWing', (m) => {
      m.diffuseColor = new Color3(0.7, 0.7, 0.8);
      m.specularColor = new Color3(0.4, 0.4, 0.5);
    });
  }

  // --- Iskander ---

  getIskanderFuselageMaterial(): StandardMaterial {
    return this.material('sharedIskanderFuselage', (m) => {
      m.diffuseColor = new Color3(0.6, 0.6, 0.7); // Dark gray
      m.specularColor = new Color3(0.4, 0.4, 0.5);
      m.emissiveColor = new Color3(0.05, 0.05, 0.08);
    });
  }

  getIskanderNoseMaterial(): StandardMaterial {
    return this.material('sharedIskanderNose', (m) => {
      m.diffuseColor = new Color3(0.3, 0.3, 0.35);
      m.specularColor = new Color3(0.7, 0.7, 0.8);
    });
  }

  getIskanderEngineMaterial(): StandardMaterial {
    return this.material('sharedIskanderEngine', (m) => {
      m.diffuseColor = new Color3(0.2, 0.2, 0.2);
      m.emissiveColor = new Color3(0.4, 0.15, 0.05);
    });
  }

  getIskanderFinMaterial(): StandardMaterial {
    return this.material('sharedIskanderFin', (m) => {
      m.diffuseColor = new Color3(0.5, 0.5, 0.6);
      m.specularColor = new Color3(0.3, 0.3, 0.4);
    });
  }

  // --- Defense missile ---

  getDefenseFuselageMaterial(): StandardMaterial {
    return this.material('sharedDefenseFuselage', (m) => {
      m.diffuseColor = new Color3(0.7, 0.7, 0.6); // Light gray
      m.specularColor = new Color3(0.3, 0.3, 0.3);
      m.emissiveColor = new Color3(0.1, 0.1, 0.1);
    });
  }

  getDefenseNoseMaterial(): StandardMaterial {
    return this.material('sharedDefenseNose', (m) => {
      m.diffuseColor = new Color3(0.2, 0.2, 0.2);
      m.specularColor = new Color3(0.5, 0.5, 0.5);
    });
  }

  getDefenseFinMaterial(): StandardMaterial {
    return this.material('sharedDefenseFin', (m) => {
      m.diffuseColor = new Color3(0.6, 0.6, 0.5);
    });
  }

  // --- Bomb ---

  getBombBodyMaterial(): StandardMaterial {
    return this.material('sharedBombBody', (m) => {
      m.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
      m.specularColor = new Color3(0.5, 0.5, 0.5);
      m.emissiveColor = new Color3(0.05, 0.05, 0.05);
    });
  }

  getBombNoseMaterial(): StandardMaterial {
    return this.material('sharedBombNose', (m) => {
      m.diffuseColor = new Color3(0.1, 0.1, 0.1); // Very dark, almost black
      m.specularColor = new Color3(0.8, 0.8, 0.8); // High specular for metallic look
      m.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
    });
  }

  getBombNoseTipMaterial(): StandardMaterial {
    return this.material('sharedBombNoseTip', (m) => {
      m.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red tip
      m.emissiveColor = new Color3(0.1, 0.02, 0.02); // Slight red glow
    });
  }

  getBombFinMaterial(): StandardMaterial {
    return this.material('sharedBombFin', (m) => {
      m.diffuseColor = new Color3(0.25, 0.25, 0.25);
    });
  }

  getBombTailMaterial(): StandardMaterial {
    return this.material('sharedBombTail', (m) => {
      m.diffuseColor = new Color3(0.5, 0.5, 0.5); // Lighter gray to distinguish from nose
      m.specularColor = new Color3(0.3, 0.3, 0.3);
    });
  }

  getBombTailIndicatorMaterial(): StandardMaterial {
    return this.material('sharedBombTailIndicator', (m) => {
      m.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray
      m.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
    });
  }

  getBombRingMaterial(): StandardMaterial {
    return this.material('sharedBombRing', (m) => {
      m.diffuseColor = new Color3(0.4, 0.4, 0.4);
    });
  }
}

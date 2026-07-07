import { Scene, Mesh, Vector3, MeshBuilder, ParticleSystem, Color4 } from '@babylonjs/core';
import { MissileAssets } from './MissileAssets';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';

export class Bomb {
  private scene: Scene;
  private mesh: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private trailParticles!: ParticleSystem;
  private lightHandle: LightHandle;

  constructor(scene: Scene, position: Vector3) {
    this.scene = scene;
    this.position = position.clone();
    this.velocity = new Vector3(0, -50, 0); // Start with a downward velocity

    // Create detailed bomb mesh using a group
    this.mesh = this.createDetailedBombMesh();
    this.mesh.position = this.position;
    this.mesh.isPickable = false;
    this.mesh.getChildMeshes().forEach((m) => (m.isPickable = false));

    // Pooled light follows the bomb (world-space; pooled lights are never parented)
    this.lightHandle = LightManager.get(scene).acquire(LightPriority.LOW);
    this.lightHandle.setColor(1, 0.6, 0);
    this.lightHandle.setIntensity(1);
    this.lightHandle.setRange(20);
    this.lightHandle.setPosition(this.position);

    this.setupTrail();
  }

  private createDetailedBombMesh(): Mesh {
    // Part materials are shared frozen instances (MissileAssets) — one set for
    // every bomb ever dropped instead of ~12 fresh materials per drop.
    const assets = MissileAssets.get(this.scene);

    // Create a group to hold all bomb parts
    const bombGroup = MeshBuilder.CreateBox('bombGroup', { width: 0.1, height: 0.1, depth: 0.1 }, this.scene);
    bombGroup.isVisible = false; // Hide the group mesh, we'll use it as a container

    // Rotate the entire bomb 180 degrees around X-axis to fix upside-down orientation
    bombGroup.rotation.x = Math.PI;

    // Main bomb body - cylindrical shape
    const bombBody = MeshBuilder.CreateCylinder(
      'bombBody',
      {
        height: 4,
        diameter: 0.8,
        tessellation: 12,
      },
      this.scene,
    );

    // No rotation needed - cylinder is already vertical by default
    bombBody.parent = bombGroup;
    bombBody.material = assets.getBombBodyMaterial();

    // Nose cone - conical shape (pointing down)
    const noseCone = MeshBuilder.CreateCylinder(
      'bombNose',
      {
        height: 1.2,
        diameterTop: 0,
        diameterBottom: 0.8,
        tessellation: 12,
      },
      this.scene,
    );

    noseCone.position.y = 2.6; // Top of bomb (pointing down when falling)
    noseCone.parent = bombGroup;
    noseCone.material = assets.getBombNoseMaterial();

    // Add a small colored tip to make orientation clear
    const noseTip = MeshBuilder.CreateSphere(
      'bombNoseTip',
      {
        diameter: 0.1,
        segments: 8,
      },
      this.scene,
    );

    noseTip.position.y = 3.2; // Very top tip
    noseTip.parent = bombGroup;
    noseTip.material = assets.getBombNoseTipMaterial();

    // Tail fins - 4 fins around the bottom (front when falling)
    const finPositions = [
      { pos: new Vector3(0, -2.2, 0.5), rot: new Vector3(0, 0, 0) },
      { pos: new Vector3(0, -2.2, -0.5), rot: new Vector3(0, 0, Math.PI) },
      { pos: new Vector3(0.5, -2.2, 0), rot: new Vector3(0, 0, Math.PI / 2) },
      { pos: new Vector3(-0.5, -2.2, 0), rot: new Vector3(0, 0, -Math.PI / 2) },
    ];

    finPositions.forEach((finData, index) => {
      const fin = MeshBuilder.CreateBox(
        `bombFin${index}`,
        {
          width: 0.05,
          height: 1.2,
          depth: 0.6,
        },
        this.scene,
      );

      fin.position = finData.pos;
      fin.rotation = finData.rot;
      fin.parent = bombGroup;
      fin.material = assets.getBombFinMaterial();
    });

    // Tail cone - small cone at the bottom (front when falling)
    const tailCone = MeshBuilder.CreateCylinder(
      'bombTail',
      {
        height: 0.8,
        diameterTop: 0.3,
        diameterBottom: 0.8,
        tessellation: 12,
      },
      this.scene,
    );

    tailCone.position.y = -2.4; // Bottom of bomb (front when falling)
    tailCone.parent = bombGroup;
    tailCone.material = assets.getBombTailMaterial();

    // Add a small indicator at the very bottom of the tail
    const tailIndicator = MeshBuilder.CreateSphere(
      'bombTailIndicator',
      {
        diameter: 0.15,
        segments: 8,
      },
      this.scene,
    );

    tailIndicator.position.y = -2.8; // Very bottom of bomb
    tailIndicator.parent = bombGroup;
    tailIndicator.material = assets.getBombTailIndicatorMaterial();

    // Add some detail rings around the body
    for (let i = 0; i < 3; i++) {
      const ring = MeshBuilder.CreateTorus(
        'bombRing' + i,
        {
          diameter: 0.85,
          thickness: 0.05,
          tessellation: 12,
        },
        this.scene,
      );

      ring.position.y = -1 + i * 1.5; // Distribute along body vertically (flipped)
      ring.parent = bombGroup;
      ring.material = assets.getBombRingMaterial();
    }

    return bombGroup;
  }

  private setupTrail(): void {
    this.trailParticles = new ParticleSystem('trail', 500, this.scene);
    this.trailParticles.particleTexture = EffectTextures.get(this.scene).getTrailTexture();
    this.trailParticles.emitter = this.mesh;
    // Emit trail from the top/rear of the bomb (positive Y) since bomb is now inverted and falling downward
    this.trailParticles.minEmitBox = new Vector3(0, 2, 0);
    this.trailParticles.maxEmitBox = new Vector3(0, 2, 0);
    this.trailParticles.color1 = new Color4(0.8, 0.8, 0.8, 0.3);
    this.trailParticles.color2 = new Color4(0.6, 0.6, 0.6, 0.2);
    this.trailParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
    this.trailParticles.minSize = 0.2;
    this.trailParticles.maxSize = 0.5;
    this.trailParticles.minLifeTime = 0.2;
    this.trailParticles.maxLifeTime = 0.4;
    this.trailParticles.emitRate = 200;
    this.trailParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.trailParticles.gravity = new Vector3(0, 0, 0);
    // Trail should go upward relative to the bomb's movement (since bomb is falling down)
    this.trailParticles.direction1 = new Vector3(0, 0.1, 0);
    this.trailParticles.direction2 = new Vector3(0, 0.1, 0);
    this.trailParticles.minEmitPower = 0.1;
    this.trailParticles.maxEmitPower = 0.3;
    this.trailParticles.updateSpeed = 0.008;
    this.trailParticles.start();
  }

  public update(deltaTime: number): void {
    // Component-wise integration — no per-frame Vector3 allocations. The mesh
    // position already aliases this.position (set once in the constructor), so
    // mutating the components moves the mesh too.
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;
    this.position.z += this.velocity.z * deltaTime;
    this.lightHandle.setPosition(this.position);
  }

  public getPosition(): Vector3 {
    return this.position;
  }

  public explode(explosionPoint: Vector3): void {
    this.trailParticles.stop();
    this.lightHandle.release();

    ExplosionPool.get(this.scene).explode(explosionPoint, 1);

    // Detach the trail from the doomed mesh first: disposing an emitter mesh
    // auto-disposes its particle systems with disposeTexture=true, which would
    // kill the shared EffectTextures trail texture for every later bomb/missile.
    this.trailParticles.emitter = this.position.clone();

    // Part materials are shared frozen instances (MissileAssets) — plain
    // dispose() (no disposeMaterialAndTextures) leaves them intact.
    this.mesh.dispose();

    // Let the last trail particles (0.4s lifetime) fade before disposing; the
    // trail texture is shared, so dispose(false) keeps it alive.
    setTimeout(() => {
      try {
        this.trailParticles.dispose(false);
      } catch (e) {
        // Silent error handling - no console logging
      }
    }, 1000);
  }

  public dispose(): void {
    // Trail before mesh: the mesh is the trail's emitter, and disposing it first
    // would auto-dispose the trail with the shared texture (see explode()).
    // Plain dispose() keeps the shared MissileAssets part materials.
    if (this.trailParticles) this.trailParticles.dispose(false);
    this.mesh.dispose();
    this.lightHandle.release();
  }
}

import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ParticleSystem,
  Sound,
  Color4,
} from '@babylonjs/core';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';

export class Bomb {
  private scene: Scene;
  private mesh: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private explosionSound: Sound | null = null;
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

    const bodyMaterial = new StandardMaterial('bombBodyMaterial', this.scene);
    bodyMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
    bodyMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
    bodyMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05);
    bombBody.material = bodyMaterial;

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

    const noseMaterial = new StandardMaterial('bombNoseMaterial', this.scene);
    noseMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Very dark, almost black
    noseMaterial.specularColor = new Color3(0.8, 0.8, 0.8); // High specular for metallic look
    noseMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
    noseCone.material = noseMaterial;

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

    const tipMaterial = new StandardMaterial('bombNoseTipMaterial', this.scene);
    tipMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red tip
    tipMaterial.emissiveColor = new Color3(0.1, 0.02, 0.02); // Slight red glow
    noseTip.material = tipMaterial;

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

      const finMaterial = new StandardMaterial(`bombFinMaterial${index}`, this.scene);
      finMaterial.diffuseColor = new Color3(0.25, 0.25, 0.25);
      fin.material = finMaterial;
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

    const tailMaterial = new StandardMaterial('bombTailMaterial', this.scene);
    tailMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5); // Lighter gray to distinguish from nose
    tailMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    tailCone.material = tailMaterial;

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

    const indicatorMaterial = new StandardMaterial('bombTailIndicatorMaterial', this.scene);
    indicatorMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray
    indicatorMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
    tailIndicator.material = indicatorMaterial;

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

      const ringMaterial = new StandardMaterial('bombRingMaterial' + i, this.scene);
      ringMaterial.diffuseColor = new Color3(0.4, 0.4, 0.4);
      ring.material = ringMaterial;
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
    this.position.addInPlace(this.velocity.scale(deltaTime));
    this.mesh.position = this.position;
    this.lightHandle.setPosition(this.position);
  }

  public getPosition(): Vector3 {
    return this.position;
  }

  public explode(explosionPoint: Vector3): void {
    this.trailParticles.stop();
    this.lightHandle.release();

    ExplosionPool.get(this.scene).explode(explosionPoint, 1);

    // Only play sound if it exists
    if (this.explosionSound) {
      this.explosionSound.play();
    }

    // Detach the trail from the doomed mesh first: disposing an emitter mesh
    // auto-disposes its particle systems with disposeTexture=true, which would
    // kill the shared EffectTextures trail texture for every later bomb/missile.
    this.trailParticles.emitter = this.position.clone();

    // Dispose part materials/textures with the hierarchy (all are per-bomb instances)
    this.mesh.dispose(false, true);

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
    if (this.trailParticles) this.trailParticles.dispose(false);
    this.mesh.dispose(false, true);
    if (this.explosionSound) this.explosionSound.dispose();
    this.lightHandle.release();
  }
}

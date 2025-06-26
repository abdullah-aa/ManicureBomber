import { Scene, Mesh, Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Sound, Color4, PointLight } from '@babylonjs/core';

export class Bomb {
    private scene: Scene;
    private mesh: Mesh;
    private position: Vector3;
    private velocity: Vector3;
    private fireParticles!: ParticleSystem;
    private smokeParticles!: ParticleSystem;
    private explosionSound!: Sound;
    private trailParticles!: ParticleSystem;
    private light!: PointLight;

    constructor(scene: Scene, position: Vector3) {
        this.scene = scene;
        this.position = position.clone();
        this.velocity = new Vector3(0, -50, 0); // Start with a downward velocity

        // Create bomb mesh
        this.mesh = MeshBuilder.CreateCylinder('bomb', { height: 3, diameter: 1 }, this.scene);
        this.mesh.position = this.position;
        const bombMaterial = new StandardMaterial('bombMaterial', this.scene);
        bombMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        bombMaterial.emissiveColor = new Color3(0.1, 0.1, 0.1);
        this.mesh.material = bombMaterial;

        // Add a light to the bomb
        this.light = new PointLight('bombLight', new Vector3(0, 0, 0), this.scene);
        this.light.diffuse = new Color3(1, 0.6, 0);
        this.light.specular = new Color3(1, 0.6, 0);
        this.light.intensity = 1;
        this.light.range = 20;
        this.light.parent = this.mesh;

        this.setupExplosionEffects();
        this.setupTrail();
    }

    private setupTrail(): void {
        this.trailParticles = new ParticleSystem('trail', 500, this.scene);
        this.trailParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/flare.png', this.scene);
        this.trailParticles.emitter = this.mesh;
        this.trailParticles.minEmitBox = new Vector3(0, 1, 0);
        this.trailParticles.maxEmitBox = new Vector3(0, 1, 0);
        this.trailParticles.color1 = new Color4(0.8, 0.8, 0.8, 0.5);
        this.trailParticles.color2 = new Color4(0.6, 0.6, 0.6, 0.5);
        this.trailParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        this.trailParticles.minSize = 0.2;
        this.trailParticles.maxSize = 0.5;
        this.trailParticles.minLifeTime = 0.5;
        this.trailParticles.maxLifeTime = 1.0;
        this.trailParticles.emitRate = 150;
        this.trailParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.trailParticles.gravity = new Vector3(0, 0, 0);
        this.trailParticles.direction1 = new Vector3(0, 0.1, 0);
        this.trailParticles.direction2 = new Vector3(0, 0.1, 0);
        this.trailParticles.minEmitPower = 0.1;
        this.trailParticles.maxEmitPower = 0.3;
        this.trailParticles.updateSpeed = 0.008;
        this.trailParticles.start();
    }

    private setupExplosionEffects(): void {
        // Fire particle system for the main explosion flash
        this.fireParticles = new ParticleSystem('fire', 2000, this.scene);
        this.fireParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/flare.png', this.scene);
        this.fireParticles.emitter = this.mesh;
        this.fireParticles.minEmitBox = new Vector3(-1, 0, -1);
        this.fireParticles.maxEmitBox = new Vector3(1, 0, 1);
        this.fireParticles.color1 = new Color4(1, 0.8, 0, 1.0);
        this.fireParticles.color2 = new Color4(1, 0.2, 0, 1.0);
        this.fireParticles.colorDead = new Color4(0.2, 0, 0, 0.0);
        this.fireParticles.minSize = 2.0;
        this.fireParticles.maxSize = 6.0;
        this.fireParticles.minLifeTime = 0.3;
        this.fireParticles.maxLifeTime = 0.6;
        this.fireParticles.emitRate = 2000;
        this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.fireParticles.gravity = new Vector3(0, -9.81, 0);
        this.fireParticles.direction1 = new Vector3(-10, 8, -10);
        this.fireParticles.direction2 = new Vector3(10, 8, 10);
        this.fireParticles.minEmitPower = 5;
        this.fireParticles.maxEmitPower = 15;
        this.fireParticles.updateSpeed = 0.005;
        this.fireParticles.manualEmitCount = 2000;
        this.fireParticles.stop();

        // Smoke particle system for lingering smoke
        this.smokeParticles = new ParticleSystem('smoke', 1000, this.scene);
        this.smokeParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/explosion/Smoke_11.png', this.scene);
        this.smokeParticles.emitter = this.mesh;
        this.smokeParticles.minEmitBox = new Vector3(-2, 0, -2);
        this.smokeParticles.maxEmitBox = new Vector3(2, 0, 2);
        this.smokeParticles.color1 = new Color4(0.2, 0.2, 0.2, 0.8);
        this.smokeParticles.color2 = new Color4(0.4, 0.4, 0.4, 0.6);
        this.smokeParticles.colorDead = new Color4(0.1, 0.1, 0.1, 0.0);
        this.smokeParticles.minSize = 4.0;
        this.smokeParticles.maxSize = 10.0;
        this.smokeParticles.minLifeTime = 2.0;
        this.smokeParticles.maxLifeTime = 5.0;
        this.smokeParticles.emitRate = 1000;
        this.smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        this.smokeParticles.gravity = new Vector3(0, -2, 0);
        this.smokeParticles.direction1 = new Vector3(-1, 3, -1);
        this.smokeParticles.direction2 = new Vector3(1, 3, 1);
        this.smokeParticles.minEmitPower = 1;
        this.smokeParticles.maxEmitPower = 3;
        this.smokeParticles.updateSpeed = 0.01;
        this.smokeParticles.manualEmitCount = 1000;
        this.smokeParticles.stop();

        // Explosion sound
        this.explosionSound = new Sound('explosionSound', 'https://assets.babylonjs.com/sound/explosion.mp3', this.scene);
    }

    public update(deltaTime: number): void {
        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.mesh.position = this.position;
    }

    public getPosition(): Vector3 {
        return this.position;
    }

    public explode(explosionPoint: Vector3): void {
        this.trailParticles.stop();
        this.light.setEnabled(false);

        this.fireParticles.emitter = explosionPoint;
        this.smokeParticles.emitter = explosionPoint;

        this.fireParticles.start();
        this.smokeParticles.start();
        this.explosionSound.play();
        this.mesh.dispose();

        // Dispose particles after they are done
        setTimeout(() => {
            this.fireParticles.dispose();
            this.trailParticles.dispose();
        }, 1000);

        setTimeout(() => {
            this.smokeParticles.dispose();
        }, 6000);
    }

    public dispose(): void {
        this.mesh.dispose();
        if (this.fireParticles) this.fireParticles.dispose();
        if (this.smokeParticles) this.smokeParticles.dispose();
        if (this.trailParticles) this.trailParticles.dispose();
        if (this.explosionSound) this.explosionSound.dispose();
        if (this.light) this.light.dispose();
    }
} 
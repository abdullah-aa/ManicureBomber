import { Scene, Mesh, Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Sound, Color4, PointLight, DynamicTexture } from '@babylonjs/core';

export class Bomb {
    private scene: Scene;
    private mesh: Mesh;
    private position: Vector3;
    private velocity: Vector3;
    private fireParticles!: ParticleSystem;
    private smokeParticles!: ParticleSystem;
    private explosionSound: Sound | null = null;
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
        
        // Create procedural trail texture instead of external URL
        const trailTexture = new DynamicTexture('trailTexture', {width: 64, height: 64}, this.scene);
        const context = trailTexture.getContext();
        
        // Create a simple white/gray dot pattern
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.5, 'rgba(200, 200, 200, 0.5)');
        gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        trailTexture.update();
        
        this.trailParticles.particleTexture = trailTexture;
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
        // Create procedural fire texture
        const fireTexture = new DynamicTexture('fireTexture', {width: 64, height: 64}, this.scene);
        const fireContext = fireTexture.getContext();
        
        // Create fire effect
        const fireGradient = fireContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        fireGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        fireGradient.addColorStop(0.3, 'rgba(255, 200, 0, 0.8)');
        fireGradient.addColorStop(0.7, 'rgba(255, 100, 0, 0.4)');
        fireGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        
        fireContext.fillStyle = fireGradient;
        fireContext.fillRect(0, 0, 64, 64);
        fireTexture.update();

        // Fire particle system for the main explosion flash
        this.fireParticles = new ParticleSystem('fire', 2000, this.scene);
        this.fireParticles.particleTexture = fireTexture;
        this.fireParticles.emitter = this.mesh;
        this.fireParticles.minEmitBox = new Vector3(-1.2, 0, -1.2);
        this.fireParticles.maxEmitBox = new Vector3(1.2, 0, 1.2);
        this.fireParticles.color1 = new Color4(1, 0.9, 0, 1.0);
        this.fireParticles.color2 = new Color4(1, 0.3, 0, 1.0);
        this.fireParticles.colorDead = new Color4(0.2, 0, 0, 0.0);
        this.fireParticles.minSize = 2.5;
        this.fireParticles.maxSize = 6.5;
        this.fireParticles.minLifeTime = 0.3;
        this.fireParticles.maxLifeTime = 0.6;
        this.fireParticles.emitRate = 2000;
        this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.fireParticles.gravity = new Vector3(0, -9.81, 0);
        this.fireParticles.direction1 = new Vector3(-10, 8, -10);
        this.fireParticles.direction2 = new Vector3(10, 10, 10);
        this.fireParticles.minEmitPower = 5;
        this.fireParticles.maxEmitPower = 15;
        this.fireParticles.updateSpeed = 0.005;
        this.fireParticles.manualEmitCount = 2000;
        this.fireParticles.stop();

        // Create procedural smoke texture
        const smokeTexture = new DynamicTexture('smokeTexture', {width: 64, height: 64}, this.scene);
        const smokeContext = smokeTexture.getContext();
        
        // Create smoke effect with noise
        smokeContext.fillStyle = 'rgba(0, 0, 0, 0)';
        smokeContext.fillRect(0, 0, 64, 64);
        
        // Add several overlapping circles for smoke effect
        for (let i = 0; i < 8; i++) {
            const x = 32 + (Math.random() - 0.5) * 40;
            const y = 32 + (Math.random() - 0.5) * 40;
            const radius = 15 + Math.random() * 15;
            const alpha = 0.1 + Math.random() * 0.3;
            
            const gradient = smokeContext.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
            gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');
            
            smokeContext.fillStyle = gradient;
            smokeContext.beginPath();
            smokeContext.arc(x, y, radius, 0, 2 * Math.PI);
            smokeContext.fill();
        }
        smokeTexture.update();

        // Smoke particle system for lingering smoke
        this.smokeParticles = new ParticleSystem('smoke', 1200, this.scene);
        this.smokeParticles.particleTexture = smokeTexture;
        this.smokeParticles.emitter = this.mesh;
        this.smokeParticles.minEmitBox = new Vector3(-2, 0, -2);
        this.smokeParticles.maxEmitBox = new Vector3(2, 0, 2);
        this.smokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.9);
        this.smokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.7);
        this.smokeParticles.colorDead = new Color4(0.1, 0.1, 0.1, 0.0);
        this.smokeParticles.minSize = 4.0;
        this.smokeParticles.maxSize = 10.0;
        this.smokeParticles.minLifeTime = 2.0;
        this.smokeParticles.maxLifeTime = 5.0;
        this.smokeParticles.emitRate = 1200;
        this.smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        this.smokeParticles.gravity = new Vector3(0, -2, 0);
        this.smokeParticles.direction1 = new Vector3(-1.2, 3, -1.2);
        this.smokeParticles.direction2 = new Vector3(1.2, 3, 1.2);
        this.smokeParticles.minEmitPower = 1.2;
        this.smokeParticles.maxEmitPower = 3;
        this.smokeParticles.updateSpeed = 0.01;
        this.smokeParticles.manualEmitCount = 1200;
        this.smokeParticles.stop();
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
        
        // Only play sound if it exists
        if (this.explosionSound) {
            this.explosionSound.play();
        }
        
        this.mesh.dispose();

        // Dispose particles after they are done
        setTimeout(() => {
            try {
                this.fireParticles.dispose();
                this.trailParticles.dispose();
            } catch (e) {
                console.warn('Error disposing fire/trail particles:', e);
            }
        }, 1000);

        setTimeout(() => {
            try {
                this.smokeParticles.dispose();
            } catch (e) {
                console.warn('Error disposing smoke particles:', e);
            }
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
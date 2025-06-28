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

        // Create detailed bomb mesh using a group
        this.mesh = this.createDetailedBombMesh();
        this.mesh.position = this.position;

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

    private createDetailedBombMesh(): Mesh {
        // Create a group to hold all bomb parts
        const bombGroup = MeshBuilder.CreateBox('bombGroup', { width: 0.1, height: 0.1, depth: 0.1 }, this.scene);
        bombGroup.isVisible = false; // Hide the group mesh, we'll use it as a container
        
        // Rotate the entire bomb 180 degrees around X-axis to fix upside-down orientation
        bombGroup.rotation.x = Math.PI;

        // Main bomb body - cylindrical shape
        const bombBody = MeshBuilder.CreateCylinder('bombBody', {
            height: 4,
            diameter: 0.8,
            tessellation: 12
        }, this.scene);
        
        // No rotation needed - cylinder is already vertical by default
        bombBody.parent = bombGroup;
        
        const bodyMaterial = new StandardMaterial('bombBodyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
        bodyMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        bodyMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05);
        bombBody.material = bodyMaterial;

        // Nose cone - conical shape (pointing down)
        const noseCone = MeshBuilder.CreateCylinder('bombNose', {
            height: 1.2,
            diameterTop: 0,
            diameterBottom: 0.8,
            tessellation: 12
        }, this.scene);
        
        noseCone.position.y = 2.6; // Top of bomb (pointing down when falling)
        noseCone.parent = bombGroup;
        
        const noseMaterial = new StandardMaterial('bombNoseMaterial', this.scene);
        noseMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Very dark, almost black
        noseMaterial.specularColor = new Color3(0.8, 0.8, 0.8); // High specular for metallic look
        noseMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
        noseCone.material = noseMaterial;

        // Add a small colored tip to make orientation clear
        const noseTip = MeshBuilder.CreateSphere('bombNoseTip', {
            diameter: 0.1,
            segments: 8
        }, this.scene);
        
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
            { pos: new Vector3(-0.5, -2.2, 0), rot: new Vector3(0, 0, -Math.PI / 2) }
        ];

        finPositions.forEach((finData, index) => {
            const fin = MeshBuilder.CreateBox(`bombFin${index}`, {
                width: 0.05,
                height: 1.2,
                depth: 0.6
            }, this.scene);

            fin.position = finData.pos;
            fin.rotation = finData.rot;
            fin.parent = bombGroup;

            const finMaterial = new StandardMaterial(`bombFinMaterial${index}`, this.scene);
            finMaterial.diffuseColor = new Color3(0.25, 0.25, 0.25);
            fin.material = finMaterial;
        });

        // Tail cone - small cone at the bottom (front when falling)
        const tailCone = MeshBuilder.CreateCylinder('bombTail', {
            height: 0.8,
            diameterTop: 0.3,
            diameterBottom: 0.8,
            tessellation: 12
        }, this.scene);
        
        tailCone.position.y = -2.4; // Bottom of bomb (front when falling)
        tailCone.parent = bombGroup;
        
        const tailMaterial = new StandardMaterial('bombTailMaterial', this.scene);
        tailMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5); // Lighter gray to distinguish from nose
        tailMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        tailCone.material = tailMaterial;

        // Add a small indicator at the very bottom of the tail
        const tailIndicator = MeshBuilder.CreateSphere('bombTailIndicator', {
            diameter: 0.15,
            segments: 8
        }, this.scene);
        
        tailIndicator.position.y = -2.8; // Very bottom of bomb
        tailIndicator.parent = bombGroup;
        
        const indicatorMaterial = new StandardMaterial('bombTailIndicatorMaterial', this.scene);
        indicatorMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray
        indicatorMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight glow
        tailIndicator.material = indicatorMaterial;

        // Add some detail rings around the body
        for (let i = 0; i < 3; i++) {
            const ring = MeshBuilder.CreateTorus('bombRing' + i, {
                diameter: 0.85,
                thickness: 0.05,
                tessellation: 12
            }, this.scene);
            
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
                // Silent error handling - no console logging
            }
        }, 1000);

        setTimeout(() => {
            try {
                this.smokeParticles.dispose();
            } catch (e) {
                // Silent error handling - no console logging
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
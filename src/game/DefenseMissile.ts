import { Scene, Mesh, Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, PointLight, TransformNode } from '@babylonjs/core';

export class DefenseMissile {
    private scene: Scene;
    private missileGroup: TransformNode;
    private fuselage!: Mesh;
    private position: Vector3;
    private velocity: Vector3;
    private targetPosition: Vector3;
    private speed: number = 80; // Slower than Tomahawk
    private launched: boolean = false;
    private exploded: boolean = false;
    private exhaustParticles!: ParticleSystem;
    private light!: PointLight;
    private lifeTime: number = 0;
    private maxLifeTime: number = 10; // Missiles self-destruct after 10 seconds

    constructor(scene: Scene, launchPosition: Vector3, targetPosition: Vector3) {
        this.scene = scene;
        this.position = launchPosition.clone();
        this.targetPosition = targetPosition.clone();
        
        // Calculate direction to target
        const direction = this.targetPosition.subtract(this.position).normalize();
        this.velocity = direction.scale(this.speed);
        
        this.missileGroup = new TransformNode('defenseMissileGroup', this.scene);
        this.missileGroup.position = this.position.clone();
        
        // Orient missile toward target
        const angle = Math.atan2(direction.x, direction.z);
        this.missileGroup.rotation.y = angle;
        
        this.createMissileModel();
        this.setupParticleEffects();
    }

    private createMissileModel(): void {
        // Simple missile body
        this.fuselage = MeshBuilder.CreateCylinder('defenseMissileFuselage', {
            height: 4,
            diameter: 0.25,
            tessellation: 6
        }, this.scene);
        
        this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally
        this.fuselage.parent = this.missileGroup;
        
        const fuselageMaterial = new StandardMaterial('defenseMissileFuselage', this.scene);
        fuselageMaterial.diffuseColor = new Color3(0.7, 0.7, 0.6); // Light gray
        fuselageMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        fuselageMaterial.emissiveColor = new Color3(0.1, 0.1, 0.1);
        this.fuselage.material = fuselageMaterial;

        // Nose cone
        const noseCone = MeshBuilder.CreateCylinder('defenseMissileNose', {
            height: 1,
            diameterTop: 0,
            diameterBottom: 0.25,
            tessellation: 6
        }, this.scene);
        
        noseCone.position.z = 2.5;
        noseCone.rotation.x = Math.PI / 2;
        noseCone.parent = this.missileGroup;
        
        const noseMaterial = new StandardMaterial('defenseMissileNoseMaterial', this.scene);
        noseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        noseMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        noseCone.material = noseMaterial;

        // Simple fins
        const finPositions = [
            { pos: new Vector3(0, 0.2, -1.5), rot: new Vector3(0, 0, 0) },
            { pos: new Vector3(0, -0.2, -1.5), rot: new Vector3(0, 0, Math.PI) },
            { pos: new Vector3(0.2, 0, -1.5), rot: new Vector3(0, 0, Math.PI / 2) },
            { pos: new Vector3(-0.2, 0, -1.5), rot: new Vector3(0, 0, -Math.PI / 2) }
        ];

        finPositions.forEach((finData, index) => {
            const fin = MeshBuilder.CreateBox(`defenseMissileFin${index}`, {
                width: 0.03,
                height: 0.8,
                depth: 0.4
            }, this.scene);

            fin.position = finData.pos;
            fin.rotation = finData.rot;
            fin.parent = this.missileGroup;

            const finMaterial = new StandardMaterial(`defenseMissileFinMaterial${index}`, this.scene);
            finMaterial.diffuseColor = new Color3(0.6, 0.6, 0.5);
            fin.material = finMaterial;
        });

        // Add missile light
        this.light = new PointLight('defenseMissileLight', new Vector3(0, 0, 0), this.scene);
        this.light.diffuse = new Color3(1, 0.8, 0.4);
        this.light.specular = new Color3(1, 0.8, 0.4);
        this.light.intensity = 1.5;
        this.light.range = 30;
        this.light.parent = this.missileGroup;
    }

    private setupParticleEffects(): void {
        // Engine exhaust particles
        this.exhaustParticles = new ParticleSystem('defenseMissileExhaust', 50, this.scene);
        this.exhaustParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        // Create emitter at rear of missile
        const emitterMesh = MeshBuilder.CreateSphere('defenseMissileEmitter', { diameter: 0.05 }, this.scene);
        emitterMesh.position = new Vector3(0, 0, -2.5);
        emitterMesh.parent = this.missileGroup;
        emitterMesh.isVisible = false;
        
        this.exhaustParticles.emitter = emitterMesh;
        this.exhaustParticles.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
        this.exhaustParticles.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
        
        this.exhaustParticles.color1 = new Color4(1, 0.7, 0.3, 1.0);
        this.exhaustParticles.color2 = new Color4(1, 0.4, 0.1, 0.8);
        this.exhaustParticles.colorDead = new Color4(0.3, 0.1, 0.05, 0.1);
        
        this.exhaustParticles.emitRate = 50;
        this.exhaustParticles.minLifeTime = 0.3;
        this.exhaustParticles.maxLifeTime = 0.6;
        this.exhaustParticles.minSize = 0.3;
        this.exhaustParticles.maxSize = 0.6;
        this.exhaustParticles.minEmitPower = 20;
        this.exhaustParticles.maxEmitPower = 30;
        this.exhaustParticles.updateSpeed = 0.01;
        
        this.exhaustParticles.direction1 = new Vector3(-0.1, -0.1, -1);
        this.exhaustParticles.direction2 = new Vector3(0.1, 0.1, -1);
        this.exhaustParticles.gravity = new Vector3(0, -5, 0);
        this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    }

    public launch(): void {
        if (this.launched) return;
        
        this.launched = true;
        this.exhaustParticles.start();
    }

    public update(deltaTime: number): void {
        if (!this.launched || this.exploded) return;

        this.lifeTime += deltaTime;
        
        // Update position
        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.missileGroup.position = this.position;

        // Check if we've reached the target or maximum lifetime
        const distanceToTarget = Vector3.Distance(this.position, this.targetPosition);
        if (distanceToTarget < 5 || this.lifeTime > this.maxLifeTime) {
            this.explode();
        }
    }

    public explode(): void {
        if (this.exploded) return;
        
        this.exploded = true;
        this.exhaustParticles.stop();
        
        // Create explosion effect
        const explosionParticles = new ParticleSystem('defenseMissileExplosion', 500, this.scene);
        explosionParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/flare.png', this.scene);
        explosionParticles.emitter = this.position;
        explosionParticles.minEmitBox = new Vector3(-1, -1, -1);
        explosionParticles.maxEmitBox = new Vector3(1, 1, 1);
        
        explosionParticles.color1 = new Color4(1, 0.9, 0.1, 1.0);
        explosionParticles.color2 = new Color4(1, 0.4, 0, 1.0);
        explosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
        
        explosionParticles.minSize = 1.0;
        explosionParticles.maxSize = 3.0;
        explosionParticles.minLifeTime = 0.5;
        explosionParticles.maxLifeTime = 1.5;
        explosionParticles.emitRate = 1000;
        explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        explosionParticles.gravity = new Vector3(0, -9.81, 0);
        explosionParticles.direction1 = new Vector3(-7, 1, -7);
        explosionParticles.direction2 = new Vector3(7, 8, 7);
        explosionParticles.minEmitPower = 5;
        explosionParticles.maxEmitPower = 15;
        
        explosionParticles.start();
        
        // Stop particles after a short time
        setTimeout(() => {
            explosionParticles.stop();
            setTimeout(() => {
                explosionParticles.dispose();
            }, 2000);
        }, 100);
        
        // Hide the missile mesh
        this.missileGroup.setEnabled(false);
    }

    public getPosition(): Vector3 {
        return this.position.clone();
    }

    public isLaunched(): boolean {
        return this.launched;
    }

    public hasExploded(): boolean {
        return this.exploded;
    }

    public dispose(): void {
        if (this.exhaustParticles) {
            this.exhaustParticles.dispose();
        }
        if (this.light) {
            this.light.dispose();
        }
        if (this.missileGroup) {
            this.missileGroup.dispose();
        }
    }
} 
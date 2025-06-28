import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, TransformNode, ParticleSystem, Texture, Color4, PointLight, Animation, AnimationGroup, DynamicTexture } from '@babylonjs/core';
import { DefenseMissile } from './DefenseMissile';

export enum BuildingType {
    RESIDENTIAL = 'residential',
    COMMERCIAL = 'commercial',
    INDUSTRIAL = 'industrial',
    SKYSCRAPER = 'skyscraper'
}

export interface BuildingConfig {
    position: { x: number; y: number; z: number };
    type: BuildingType;
    width: number;
    height: number;
    depth: number;
    color?: Color3;
    isTarget?: boolean;
    isDefenseLauncher?: boolean;
}

export class Building {
    private scene: Scene;
    private mesh: Mesh;
    private parent: TransformNode;
    private config: BuildingConfig;
    private targetRing: Mesh | null = null;
    private damage: number = 0;
    private maxHealth: number = 100;
    private isDestroyed: boolean = false;
    private fireParticles: ParticleSystem | null = null;
    private smokeParticles: ParticleSystem | null = null;
    private damageLight: PointLight | null = null;
    
    // Defense launcher properties
    private launcherMesh: Mesh | null = null;
    private defenseMissiles: DefenseMissile[] = [];
    private lastMissileLaunchTime: number = 0;
    private missileLaunchInterval: number = 8; // Launch every 8 seconds
    private radarScanRange: number = 300; // Detection range
    
    // Callback for destruction notification
    private onDestroyedCallback: (() => void) | null = null;

    constructor(scene: Scene, config: BuildingConfig) {
        this.scene = scene;
        this.config = config;
        this.parent = new TransformNode(`building_${config.type}_${Date.now()}`, scene);
        this.mesh = this.createBuildingMesh();
        this.setupMaterial();
        this.positionBuilding();
        
        if (config.isTarget) {
            this.createTargetIndicator();
        }
        
        if (config.isDefenseLauncher) {
            this.createDefenseLauncher();
        }
        
        this.setupDamageEffects();
    }

    private createBuildingMesh(): Mesh {
        const { width, height, depth, type } = this.config;
        
        switch (type) {
            case BuildingType.RESIDENTIAL:
                return this.createResidentialBuilding(width, height, depth);
            case BuildingType.COMMERCIAL:
                return this.createCommercialBuilding(width, height, depth);
            case BuildingType.INDUSTRIAL:
                return this.createIndustrialBuilding(width, height, depth);
            case BuildingType.SKYSCRAPER:
                return this.createSkyscraper(width, height, depth);
            default:
                return this.createBasicBuilding(width, height, depth);
        }
    }

    private createBasicBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_basic`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        building.parent = this.parent;
        return building;
    }

    private createResidentialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_residential`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add a simple roof
        const roof = MeshBuilder.CreateBox(`roof`, {
            width: width + 2,
            height: 2,
            depth: depth + 2
        }, this.scene);
        
        roof.position.y = height / 2 + 1;
        roof.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private createCommercialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_commercial`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add antenna or signage on top
        const antenna = MeshBuilder.CreateCylinder(`antenna`, {
            height: 4,
            diameterTop: 0.5,
            diameterBottom: 1
        }, this.scene);
        
        antenna.position.y = height / 2 + 2;
        antenna.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private createIndustrialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_industrial`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add smokestacks
        const numStacks = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < numStacks; i++) {
            const stack = MeshBuilder.CreateCylinder(`smokestack_${i}`, {
                height: height * 0.8,
                diameter: 2
            }, this.scene);
            
            stack.position.x = (Math.random() - 0.5) * width * 0.6;
            stack.position.z = (Math.random() - 0.5) * depth * 0.6;
            stack.position.y = height / 2 + (height * 0.8) / 2;
            stack.parent = this.parent;
        }
        
        building.parent = this.parent;
        return building;
    }

    private createSkyscraper(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_skyscraper`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add multiple tiers for skyscraper effect
        const tier1 = MeshBuilder.CreateBox(`tier1`, {
            width: width * 0.8,
            height: height * 0.3,
            depth: depth * 0.8
        }, this.scene);
        
        const tier2 = MeshBuilder.CreateBox(`tier2`, {
            width: width * 0.6,
            height: height * 0.2,
            depth: depth * 0.6
        }, this.scene);
        
        tier1.position.y = height / 2 + (height * 0.3) / 2;
        tier2.position.y = height / 2 + height * 0.3 + (height * 0.2) / 2;
        
        tier1.parent = this.parent;
        tier2.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private setupMaterial(): void {
        const material = new StandardMaterial(`buildingMaterial_${this.config.type}`, this.scene);
        
        // Set color based on building type or use provided color
        if (this.config.color) {
            material.diffuseColor = this.config.color;
        } else {
            switch (this.config.type) {
                case BuildingType.RESIDENTIAL:
                    material.diffuseColor = new Color3(0.8, 0.7, 0.6); // Warm beige
                    break;
                case BuildingType.COMMERCIAL:
                    material.diffuseColor = new Color3(0.6, 0.8, 0.9); // Light blue
                    break;
                case BuildingType.INDUSTRIAL:
                    material.diffuseColor = new Color3(0.5, 0.5, 0.5); // Gray
                    break;
                case BuildingType.SKYSCRAPER:
                    material.diffuseColor = new Color3(0.3, 0.3, 0.4); // Dark blue-gray
                    break;
                default:
                    material.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray
            }
        }
        
        material.specularColor = new Color3(0.1, 0.1, 0.1);
        
        // Apply material to all child meshes
        this.parent.getChildMeshes().forEach(mesh => {
            mesh.material = material;
        });
    }

    private positionBuilding(): void {
        this.parent.position.x = this.config.position.x;
        this.parent.position.z = this.config.position.z;
        this.parent.position.y = 0;
    }

    public getPosition(): Vector3 {
        return this.parent.position;
    }

    public getBounds(): { min: Vector3; max: Vector3 } {
        const pos = this.parent.position;
        const halfWidth = this.config.width / 2;
        const halfDepth = this.config.depth / 2;
        
        return {
            min: new Vector3(pos.x - halfWidth, pos.y - this.config.height / 2, pos.z - halfDepth),
            max: new Vector3(pos.x + halfWidth, pos.y + this.config.height / 2, pos.z + halfDepth)
        };
    }

    private createTargetIndicator(): void {
        this.targetRing = MeshBuilder.CreateTorus('targetRing', {
            diameter: Math.max(this.config.width, this.config.depth) + 10,
            thickness: 1
        }, this.scene);
        
        this.targetRing.position.y = this.config.height + 5;
        this.targetRing.parent = this.parent;
        
        const ringMaterial = new StandardMaterial('ringMaterial', this.scene);
        ringMaterial.emissiveColor = new Color3(1, 0, 0); // Red glow
        ringMaterial.diffuseColor = new Color3(0.8, 0, 0);
        this.targetRing.material = ringMaterial;
    }

    private createDefenseLauncher(): void {
        // Create a missile launcher on top of the building
        this.launcherMesh = MeshBuilder.CreateBox(`launcher_${Date.now()}`, {
            width: 3,
            height: 2,
            depth: 3
        }, this.scene);

        this.launcherMesh.position.y = this.config.height;
        this.launcherMesh.parent = this.parent;

        const launcherMaterial = new StandardMaterial(`launcherMaterial_${Date.now()}`, this.scene);
        launcherMaterial.diffuseColor = new Color3(1.0, 0.5, 0.0); // Orange
        launcherMaterial.specularColor = new Color3(1.0, 0.7, 0.3);
        launcherMaterial.emissiveColor = new Color3(0.3, 0.15, 0.0); // Base orange glow
        
        // Create flashing animation
        const emissiveAnimation = new Animation("launcherFlash", "emissiveColor", 30, Animation.ANIMATIONTYPE_COLOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        
        const keyFrames = [];
        keyFrames.push({
            frame: 0,
            value: new Color3(0.3, 0.15, 0.0) // Dim orange
        });
        keyFrames.push({
            frame: 15,
            value: new Color3(1.0, 0.5, 0.0) // Bright orange
        });
        keyFrames.push({
            frame: 30,
            value: new Color3(0.3, 0.15, 0.0) // Back to dim orange
        });
        
        emissiveAnimation.setKeys(keyFrames);
        launcherMaterial.animations = [emissiveAnimation];
        
        // Start the animation
        this.scene.beginAnimation(launcherMaterial, 0, 30, true);
        
        this.launcherMesh.material = launcherMaterial;
    }

    private setupDamageEffects(): void {
        // Create procedural fire texture
        const fireTexture = new DynamicTexture('buildingFireTexture', {width: 64, height: 64}, this.scene);
        const fireContext = fireTexture.getContext();
        
        // Create fire effect with gradient
        const fireGradient = fireContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        fireGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        fireGradient.addColorStop(0.3, 'rgba(255, 200, 0, 0.8)');
        fireGradient.addColorStop(0.7, 'rgba(255, 100, 0, 0.4)');
        fireGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        
        fireContext.fillStyle = fireGradient;
        fireContext.fillRect(0, 0, 64, 64);
        fireTexture.update();

        // Fire particles for when building is damaged
        this.fireParticles = new ParticleSystem('buildingFire', 200, this.scene);
        this.fireParticles.particleTexture = fireTexture;
        this.fireParticles.emitter = this.parent.position;
        this.fireParticles.minEmitBox = new Vector3(-this.config.width/2, 0, -this.config.depth/2);
        this.fireParticles.maxEmitBox = new Vector3(this.config.width/2, this.config.height, this.config.depth/2);
        this.fireParticles.color1 = new Color4(1, 0.8, 0, 0.8);
        this.fireParticles.color2 = new Color4(1, 0.3, 0, 0.6);
        this.fireParticles.colorDead = new Color4(0.2, 0, 0, 0.0);
        this.fireParticles.minSize = 1.0;
        this.fireParticles.maxSize = 3.0;
        this.fireParticles.minLifeTime = 0.5;
        this.fireParticles.maxLifeTime = 1.5;
        this.fireParticles.emitRate = 50;
        this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.fireParticles.gravity = new Vector3(0, -2, 0);
        this.fireParticles.direction1 = new Vector3(-1, 2, -1);
        this.fireParticles.direction2 = new Vector3(1, 4, 1);
        this.fireParticles.minEmitPower = 1;
        this.fireParticles.maxEmitPower = 3;
        this.fireParticles.stop();

        // Create procedural smoke texture
        const smokeTexture = new DynamicTexture('buildingSmokeTexture', {width: 64, height: 64}, this.scene);
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

        // Smoke particles
        this.smokeParticles = new ParticleSystem('buildingSmoke', 150, this.scene);
        this.smokeParticles.particleTexture = smokeTexture;
        this.smokeParticles.emitter = this.parent.position;
        this.smokeParticles.minEmitBox = new Vector3(-this.config.width/2, this.config.height/2, -this.config.depth/2);
        this.smokeParticles.maxEmitBox = new Vector3(this.config.width/2, this.config.height, this.config.depth/2);
        this.smokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.6);
        this.smokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.4);
        this.smokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        this.smokeParticles.minSize = 2.0;
        this.smokeParticles.maxSize = 6.0;
        this.smokeParticles.minLifeTime = 2.0;
        this.smokeParticles.maxLifeTime = 4.0;
        this.smokeParticles.emitRate = 30;
        this.smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        this.smokeParticles.gravity = new Vector3(0, -1, 0);
        this.smokeParticles.direction1 = new Vector3(-0.5, 2, -0.5);
        this.smokeParticles.direction2 = new Vector3(0.5, 3, 0.5);
        this.smokeParticles.minEmitPower = 0.5;
        this.smokeParticles.maxEmitPower = 1.5;
        this.smokeParticles.stop();

        // Damage light
        this.damageLight = new PointLight('damageLight', Vector3.Zero(), this.scene);
        this.damageLight.diffuse = new Color3(1, 0.3, 0);
        this.damageLight.specular = new Color3(1, 0.3, 0);
        this.damageLight.intensity = 0;
        this.damageLight.range = 30;
        this.damageLight.parent = this.parent;
        this.damageLight.position.y = this.config.height / 2;
    }

    public takeDamage(damage: number, isBombDamage: boolean = false): boolean {
        if (this.isDestroyed) return false;

        this.damage += damage;
        const damagePercent = this.damage / this.maxHealth;

        // Start fire and smoke effects when damaged
        if (damagePercent > 0.3 && this.fireParticles && !this.fireParticles.isStarted()) {
            this.fireParticles.start();
        }
        
        if (damagePercent > 0.5 && this.smokeParticles && !this.smokeParticles.isStarted()) {
            this.smokeParticles.start();
        }

        // Update damage light intensity
        if (this.damageLight) {
            this.damageLight.intensity = damagePercent * 2;
        }

        // Check if building is destroyed
        if (this.damage >= this.maxHealth) {
            if (isBombDamage) {
                this.destroyBuildingByBomb();
            } else {
                this.destroyBuilding();
            }
            return true; // Building was destroyed
        }

        return false; // Building still standing
    }

    private destroyBuilding(): void {
        this.isDestroyed = true;

        // Trigger destruction callback if set
        if (this.onDestroyedCallback) {
            this.onDestroyedCallback();
        }

        // Create procedural explosion texture
        const explosionTexture = new DynamicTexture('buildingExplosionTexture', {width: 64, height: 64}, this.scene);
        const explosionContext = explosionTexture.getContext();
        
        // Create explosion effect with bright center and fading edges
        const explosionGradient = explosionContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        explosionGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        explosionGradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.9)');
        explosionGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
        explosionGradient.addColorStop(0.8, 'rgba(255, 50, 0, 0.3)');
        explosionGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        
        explosionContext.fillStyle = explosionGradient;
        explosionContext.fillRect(0, 0, 64, 64);
        explosionTexture.update();

        // Create destruction explosion
        const explosionParticles = new ParticleSystem('buildingExplosion', 400, this.scene);
        explosionParticles.particleTexture = explosionTexture;
        explosionParticles.emitter = this.parent.position;
        explosionParticles.minEmitBox = new Vector3(-this.config.width/2, 0, -this.config.depth/2);
        explosionParticles.maxEmitBox = new Vector3(this.config.width/2, this.config.height, this.config.depth/2);
        explosionParticles.color1 = new Color4(1, 0.8, 0, 1.0);
        explosionParticles.color2 = new Color4(1, 0.3, 0, 1.0);
        explosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
        explosionParticles.minSize = 1.0;
        explosionParticles.maxSize = 4.0;
        explosionParticles.minLifeTime = 0.8;
        explosionParticles.maxLifeTime = 2.0;
        explosionParticles.emitRate = 400;
        explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        explosionParticles.gravity = new Vector3(0, -5, 0);
        explosionParticles.direction1 = new Vector3(-3, 3, -3);
        explosionParticles.direction2 = new Vector3(3, 6, 3);
        explosionParticles.minEmitPower = 2;
        explosionParticles.maxEmitPower = 5;
        explosionParticles.manualEmitCount = 400;
        explosionParticles.start();

        // Dispose of explosion particles after time
        setTimeout(() => {
            explosionParticles.dispose();
        }, 5000);

        // Fade out and dispose building
        setTimeout(() => {
            this.dispose();
        }, 1000);
    }

    private destroyBuildingByBomb(): void {
        this.isDestroyed = true;

        // Trigger destruction callback if set
        if (this.onDestroyedCallback) {
            this.onDestroyedCallback();
        }

        // Create procedural bomb explosion texture with more dramatic colors
        const bombExplosionTexture = new DynamicTexture('buildingBombExplosionTexture', {width: 64, height: 64}, this.scene);
        const bombExplosionContext = bombExplosionTexture.getContext();
        
        // Create more dramatic explosion effect with brighter colors
        const bombExplosionGradient = bombExplosionContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        bombExplosionGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        bombExplosionGradient.addColorStop(0.1, 'rgba(255, 255, 0, 1)');
        bombExplosionGradient.addColorStop(0.3, 'rgba(255, 150, 0, 0.9)');
        bombExplosionGradient.addColorStop(0.6, 'rgba(255, 50, 0, 0.7)');
        bombExplosionGradient.addColorStop(0.9, 'rgba(200, 0, 0, 0.3)');
        bombExplosionGradient.addColorStop(1, 'rgba(100, 0, 0, 0)');
        
        bombExplosionContext.fillStyle = bombExplosionGradient;
        bombExplosionContext.fillRect(0, 0, 64, 64);
        bombExplosionTexture.update();

        // Create dramatic bomb destruction explosion
        const bombExplosionParticles = new ParticleSystem('buildingBombExplosion', 800, this.scene); // More particles
        bombExplosionParticles.particleTexture = bombExplosionTexture;
        bombExplosionParticles.emitter = this.parent.position;
        bombExplosionParticles.minEmitBox = new Vector3(-this.config.width/2, 0, -this.config.depth/2);
        bombExplosionParticles.maxEmitBox = new Vector3(this.config.width/2, this.config.height, this.config.depth/2);
        bombExplosionParticles.color1 = new Color4(1, 0.9, 0, 1.0); // Brighter yellow
        bombExplosionParticles.color2 = new Color4(1, 0.4, 0, 1.0); // Brighter orange
        bombExplosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
        bombExplosionParticles.minSize = 2.0; // Larger particles
        bombExplosionParticles.maxSize = 6.0; // Larger particles
        bombExplosionParticles.minLifeTime = 1.2; // Longer duration
        bombExplosionParticles.maxLifeTime = 2.5; // Longer duration
        bombExplosionParticles.emitRate = 800; // Higher emission rate
        bombExplosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        bombExplosionParticles.gravity = new Vector3(0, -5, 0);
        bombExplosionParticles.direction1 = new Vector3(-5, 5, -5); // More spread
        bombExplosionParticles.direction2 = new Vector3(5, 10, 5); // More spread
        bombExplosionParticles.minEmitPower = 4; // More power
        bombExplosionParticles.maxEmitPower = 8; // More power
        bombExplosionParticles.manualEmitCount = 800;
        bombExplosionParticles.start();

        // Create additional debris particles for bomb destruction
        const debrisTexture = new DynamicTexture('buildingDebrisTexture', {width: 32, height: 32}, this.scene);
        const debrisContext = debrisTexture.getContext();
        debrisContext.fillStyle = 'rgba(100, 100, 100, 1)';
        debrisContext.fillRect(0, 0, 32, 32);
        debrisTexture.update();

        const debrisParticles = new ParticleSystem('buildingDebris', 300, this.scene);
        debrisParticles.particleTexture = debrisTexture;
        debrisParticles.emitter = this.parent.position;
        debrisParticles.minEmitBox = new Vector3(-this.config.width/2, 0, -this.config.depth/2);
        debrisParticles.maxEmitBox = new Vector3(this.config.width/2, this.config.height, this.config.depth/2);
        debrisParticles.color1 = new Color4(0.6, 0.6, 0.6, 1.0);
        debrisParticles.color2 = new Color4(0.4, 0.4, 0.4, 0.8);
        debrisParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        debrisParticles.minSize = 0.5;
        debrisParticles.maxSize = 2.0;
        debrisParticles.minLifeTime = 2.0;
        debrisParticles.maxLifeTime = 4.0;
        debrisParticles.emitRate = 300;
        debrisParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        debrisParticles.gravity = new Vector3(0, -15, 0); // Stronger gravity for debris
        debrisParticles.direction1 = new Vector3(-8, 3, -8);
        debrisParticles.direction2 = new Vector3(8, 8, 8);
        debrisParticles.minEmitPower = 3;
        debrisParticles.maxEmitPower = 6;
        debrisParticles.manualEmitCount = 300;
        debrisParticles.start();

        // Dispose of explosion particles after time
        setTimeout(() => {
            bombExplosionParticles.dispose();
            debrisParticles.dispose();
        }, 6000); // Longer duration for bomb effects

        // Fade out and dispose building
        setTimeout(() => {
            this.dispose();
        }, 1500); // Slightly longer delay
    }

    public isTarget(): boolean {
        return this.config.isTarget || false;
    }

    public getIsDestroyed(): boolean {
        return this.isDestroyed;
    }

    public setOnDestroyedCallback(callback: () => void): void {
        this.onDestroyedCallback = callback;
    }

    public getMaxHeight(): number {
        return this.config.height;
    }

    public updateDefenseLauncher(bomberPosition: Vector3, currentTime: number, deltaTime: number): void {
        if (!this.config.isDefenseLauncher || this.isDestroyed) return;

        // Update existing missiles
        for (let i = this.defenseMissiles.length - 1; i >= 0; i--) {
            const missile = this.defenseMissiles[i];
            missile.update(deltaTime);
            
            // Remove exploded missiles
            if (missile.hasExploded()) {
                missile.dispose();
                this.defenseMissiles.splice(i, 1);
            }
        }

        // Check if we should launch a new missile
        const distanceToBomber = Vector3.Distance(this.getPosition(), bomberPosition);
        if (distanceToBomber <= this.radarScanRange && 
            (currentTime - this.lastMissileLaunchTime) >= this.missileLaunchInterval) {
            
            this.launchDefenseMissile(bomberPosition);
            this.lastMissileLaunchTime = currentTime;
        }
    }

    private launchDefenseMissile(bomberPosition: Vector3): void {
        if (!this.config.isDefenseLauncher || this.isDestroyed) return;

        const launchPosition = this.getPosition().clone();
        launchPosition.y += this.config.height + 3; // Launch from top of launcher

        // Add some inaccuracy to make the missile aim slightly off target
        const inaccuracy = 20; // Units of inaccuracy
        const targetPosition = bomberPosition.clone();
        targetPosition.x += (Math.random() - 0.5) * inaccuracy;
        targetPosition.y += (Math.random() - 0.5) * inaccuracy;
        targetPosition.z += (Math.random() - 0.5) * inaccuracy;
        
        const missile = new DefenseMissile(this.scene, launchPosition, targetPosition);
        missile.launch();
        this.defenseMissiles.push(missile);
    }

    public isDefenseLauncher(): boolean {
        return this.config.isDefenseLauncher || false;
    }

    public getActiveMissiles(): DefenseMissile[] {
        if (!this.config.isDefenseLauncher) return [];
        
        // Return only missiles that haven't exploded
        return this.defenseMissiles.filter(missile => !missile.hasExploded());
    }

    public getDefenseMissiles(): DefenseMissile[] {
        if (!this.config.isDefenseLauncher) return [];
        
        // Return all missiles including exploded ones for collision detection
        return this.defenseMissiles;
    }

    public dispose(): void {
        if (this.targetRing) this.targetRing.dispose();
        if (this.fireParticles) this.fireParticles.dispose();
        if (this.smokeParticles) this.smokeParticles.dispose();
        if (this.damageLight) this.damageLight.dispose();
        if (this.launcherMesh) this.launcherMesh.dispose();
        
        // Dispose all defense missiles
        this.defenseMissiles.forEach(missile => missile.dispose());
        this.defenseMissiles = [];
        
        this.parent.dispose();
    }

    
} 
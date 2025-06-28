import { Scene, Mesh, Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, PointLight, TransformNode, DynamicTexture } from '@babylonjs/core';
import { B2Bomber } from './B2Bomber';

export class IskanderMissile {
    private scene: Scene;
    private missileGroup: TransformNode;
    private fuselage!: Mesh;
    private position: Vector3;
    private velocity: Vector3;
    private rotation: Vector3;
    private targetPosition: Vector3;
    private bomber: B2Bomber;
    private speed: number = 120; // Slightly slower than Tomahawk
    private turnRate: number = 1.5; // How fast the missile can turn
    private launched: boolean = false;
    private exploded: boolean = false;
    private exhaustParticles!: ParticleSystem;
    private trailParticles!: ParticleSystem;
    private flightSmokeParticles!: ParticleSystem;
    private fireParticles!: ParticleSystem;
    private explosionSmokeParticles!: ParticleSystem;
    private shockwaveParticles!: ParticleSystem;
    private sparkParticles!: ParticleSystem;
    private light!: PointLight;
    
    // Curved path navigation properties (like Tomahawk)
    private pathTime: number = 0;
    private pathSpeed: number = 0.4; // Speed along the curved path
    private waypoints: Vector3[] = [];
    
    // Performance optimization: cached calculations
    private lastUpdateTime: number = 0;
    private updateInterval: number = 1/60; // 60 FPS max updates
    private cachedCurvePosition: Vector3 = new Vector3();
    private curveCacheValid: boolean = false;
    private lastCurveTime: number = -1;
    
    // Countermeasure flare targeting
    private flareTargets: Vector3[] = [];
    private currentTargetIndex: number = 0;
    private flareDetectionRange: number = 50; // Range to detect flares
    private flareAttractionStrength: number = 0.7; // How strongly flares attract the missile
    private originalTargetPosition: Vector3;
    private isTargetingFlare: boolean = false;

    // Lock-on system properties
    private lockOnRange: number = 400; // Range at which missile can lock onto bomber
    private isLockedOn: boolean = false;
    private lockOnTime: number = 0;
    private lockOnDuration: number = 1.0; // Time required to establish lock
    private guidanceStrength: number = 2.0; // How strongly the missile turns toward target
    private maxTurnRate: number = 3.0; // Maximum turn rate in radians per second
    private lastTargetUpdateTime: number = 0;
    private targetUpdateInterval: number = 0.1; // Update target position every 100ms

    // Lock establishment callback
    private onLockEstablishedCallback: (() => void) | null = null;

    constructor(scene: Scene, launchPosition: Vector3, bomber: B2Bomber) {
        this.scene = scene;
        this.position = launchPosition.clone();
        this.bomber = bomber;
        this.targetPosition = bomber.getPosition().clone();
        this.originalTargetPosition = this.targetPosition.clone();
        this.rotation = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0); // Start stationary
        
        this.missileGroup = new TransformNode('iskanderGroup', this.scene);
        this.missileGroup.position = this.position.clone();
        this.missileGroup.rotation = this.rotation.clone();
        
        this.createMissileModel();
        this.setupParticleEffects();
        this.setupExplosionEffects();
        this.generateCurvedPath();
    }

    private generateCurvedPath(): void {
        // Create a curved path from launch position to bomber
        this.waypoints = [this.position.clone(), this.targetPosition.clone()];
    }

    private getCurvedPathPosition(t: number): Vector3 {
        // Use cached result if available
        if (this.curveCacheValid && Math.abs(t - this.lastCurveTime) < 0.01) {
            return this.cachedCurvePosition.clone();
        }

        // Create a curved path using parametric equations
        const startPos = this.waypoints[0];
        const endPos = this.waypoints[1];
        
        // Linear interpolation for base path
        const basePos = Vector3.Lerp(startPos, endPos, t);
        
        // Add curved deviation
        const distance = Vector3.Distance(startPos, endPos);
        const curveAmplitude = distance * 0.2; // 20% curve amplitude
        
        // Create a winding curve using sine waves
        const curveX = Math.sin(t * Math.PI * 2) * curveAmplitude;
        const curveZ = Math.cos(t * Math.PI * 1.5) * curveAmplitude;
        const curveY = Math.sin(t * Math.PI) * 30; // Height variation
        
        // Cache the result
        this.cachedCurvePosition.set(
            basePos.x + curveX,
            basePos.y + curveY,
            basePos.z + curveZ
        );
        this.lastCurveTime = t;
        this.curveCacheValid = true;
        
        return this.cachedCurvePosition.clone();
    }

    private createMissileModel(): void {
        // Main fuselage - sleek ballistic missile body
        this.fuselage = MeshBuilder.CreateCylinder('iskanderFuselage', {
            height: 5,
            diameter: 0.5,
            tessellation: 12
        }, this.scene);
        
        this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally pointing forward
        this.fuselage.parent = this.missileGroup;
        
        const fuselageMaterial = new StandardMaterial('iskanderFuselage', this.scene);
        fuselageMaterial.diffuseColor = new Color3(0.6, 0.6, 0.7); // Dark gray
        fuselageMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
        fuselageMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
        this.fuselage.material = fuselageMaterial;

        // Nose cone
        const noseCone = MeshBuilder.CreateCylinder('iskanderNose', {
            height: 1.2,
            diameterTop: 0,
            diameterBottom: 0.5,
            tessellation: 12
        }, this.scene);
        
        noseCone.position.z = 3.1; // Front of missile
        noseCone.rotation.x = Math.PI / 2;
        noseCone.parent = this.missileGroup;
        
        const noseMaterial = new StandardMaterial('iskanderNoseMaterial', this.scene);
        noseMaterial.diffuseColor = new Color3(0.3, 0.3, 0.35);
        noseMaterial.specularColor = new Color3(0.7, 0.7, 0.8);
        noseCone.material = noseMaterial;

        // Control fins
        this.createControlFins();
        
        // Engine nozzle
        const engineNozzle = MeshBuilder.CreateCylinder('iskanderEngine', {
            height: 1.2,
            diameter: 0.4,
            tessellation: 12
        }, this.scene);
        
        engineNozzle.position.z = -3.1; // Rear of missile
        engineNozzle.rotation.x = Math.PI / 2;
        engineNozzle.parent = this.missileGroup;
        
        const engineMaterial = new StandardMaterial('iskanderEngineMaterial', this.scene);
        engineMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        engineMaterial.emissiveColor = new Color3(0.4, 0.15, 0.05);
        engineNozzle.material = engineMaterial;

        // Add missile light with red tint
        this.light = new PointLight('iskanderLight', new Vector3(0, 0, 0), this.scene);
        this.light.diffuse = new Color3(1, 0.2, 0.1);
        this.light.specular = new Color3(1, 0.2, 0.1);
        this.light.intensity = 4;
        this.light.range = 60;
        this.light.parent = this.missileGroup;
    }

    private createControlFins(): void {
        // Control fins for guidance
        const finPositions = [
            { pos: new Vector3(0, 0.4, -1.5), rot: new Vector3(0, 0, 0) },
            { pos: new Vector3(0, -0.4, -1.5), rot: new Vector3(0, 0, Math.PI) },
            { pos: new Vector3(0.4, 0, -1.5), rot: new Vector3(0, 0, Math.PI / 2) },
            { pos: new Vector3(-0.4, 0, -1.5), rot: new Vector3(0, 0, -Math.PI / 2) }
        ];

        finPositions.forEach((finData, index) => {
            const fin = MeshBuilder.CreateBox(`iskanderFin${index}`, {
                width: 0.08,
                height: 1.2,
                depth: 0.8
            }, this.scene);

            fin.position = finData.pos;
            fin.rotation = finData.rot;
            fin.parent = this.missileGroup;

            const finMaterial = new StandardMaterial(`iskanderFinMaterial${index}`, this.scene);
            finMaterial.diffuseColor = new Color3(0.5, 0.5, 0.6);
            finMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
            fin.material = finMaterial;
        });
    }

    private setupParticleEffects(): void {
        // Engine exhaust particles
        this.exhaustParticles = new ParticleSystem('iskanderExhaust', 100, this.scene);
        this.exhaustParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        // Create emitter at rear of missile
        const emitterMesh = MeshBuilder.CreateSphere('iskanderEmitter', { diameter: 0.1 }, this.scene);
        emitterMesh.position = new Vector3(0, 0, -3.5); // Rear of missile
        emitterMesh.parent = this.missileGroup;
        emitterMesh.isVisible = false;
        
        this.exhaustParticles.emitter = emitterMesh;
        this.exhaustParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        this.exhaustParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Red-orange exhaust for Iskander
        this.exhaustParticles.color1 = new Color4(1, 0.3, 0.1, 1.0); // Bright red-orange
        this.exhaustParticles.color2 = new Color4(1, 0.1, 0.05, 0.9); // Deep red
        this.exhaustParticles.colorDead = new Color4(0.3, 0.05, 0.02, 0.1);
        
        this.exhaustParticles.emitRate = 100;
        this.exhaustParticles.minLifeTime = 0.4;
        this.exhaustParticles.maxLifeTime = 0.8;
        this.exhaustParticles.minSize = 0.4;
        this.exhaustParticles.maxSize = 1.5;
        this.exhaustParticles.minEmitPower = 50;
        this.exhaustParticles.maxEmitPower = 80;
        this.exhaustParticles.updateSpeed = 0.01;
        
        this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
        this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
        this.exhaustParticles.gravity = new Vector3(0, 0, 0);
        this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        // Create procedural trail texture
        const trailTexture = new DynamicTexture('iskanderTrailTexture', {width: 64, height: 64}, this.scene);
        const trailContext = trailTexture.getContext();
        
        // Create a red-tinted trail pattern
        const trailGradient = trailContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        trailGradient.addColorStop(0, 'rgba(255, 100, 100, 1)');
        trailGradient.addColorStop(0.5, 'rgba(200, 50, 50, 0.5)');
        trailGradient.addColorStop(1, 'rgba(100, 25, 25, 0)');
        
        trailContext.fillStyle = trailGradient;
        trailContext.fillRect(0, 0, 64, 64);
        trailTexture.update();

        // Vapor trail particles
        this.trailParticles = new ParticleSystem('iskanderTrail', 200, this.scene);
        this.trailParticles.particleTexture = trailTexture;
        this.trailParticles.emitter = emitterMesh;
        this.trailParticles.minEmitBox = new Vector3(0, 0, 0);
        this.trailParticles.maxEmitBox = new Vector3(0, 0, 0);
        
        // Red-tinted trail colors
        this.trailParticles.color1 = new Color4(1.0, 0.4, 0.4, 0.6);
        this.trailParticles.color2 = new Color4(0.8, 0.2, 0.2, 0.4);
        this.trailParticles.colorDead = new Color4(0.4, 0.1, 0.1, 0.0);
        
        this.trailParticles.emitRate = 100;
        this.trailParticles.minLifeTime = 2.0;
        this.trailParticles.maxLifeTime = 4.0;
        this.trailParticles.minSize = 1.0;
        this.trailParticles.maxSize = 3.0;
        this.trailParticles.minEmitPower = 3;
        this.trailParticles.maxEmitPower = 8;
        this.trailParticles.updateSpeed = 0.01;
        
        this.trailParticles.direction1 = new Vector3(0, 0, -0.3);
        this.trailParticles.direction2 = new Vector3(0, 0, 0.3);
        this.trailParticles.gravity = new Vector3(0, -1, 0);
        this.trailParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        // Smoke trail
        const smokeTexture = new DynamicTexture('iskanderSmokeTexture', {width: 64, height: 64}, this.scene);
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
            gradient.addColorStop(0, `rgba(80, 80, 80, ${alpha})`);
            gradient.addColorStop(1, 'rgba(40, 40, 40, 0)');
            
            smokeContext.fillStyle = gradient;
            smokeContext.beginPath();
            smokeContext.arc(x, y, radius, 0, 2 * Math.PI);
            smokeContext.fill();
        }
        smokeTexture.update();
        
        this.flightSmokeParticles = new ParticleSystem('iskanderSmoke', 80, this.scene);
        this.flightSmokeParticles.particleTexture = smokeTexture;
        this.flightSmokeParticles.emitter = emitterMesh;
        this.flightSmokeParticles.minEmitBox = new Vector3(0, 0, 0);
        this.flightSmokeParticles.maxEmitBox = new Vector3(0, 0, 0);
        
        this.flightSmokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.4);
        this.flightSmokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.3);
        this.flightSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        
        this.flightSmokeParticles.emitRate = 50;
        this.flightSmokeParticles.minLifeTime = 3.0;
        this.flightSmokeParticles.maxLifeTime = 6.0;
        this.flightSmokeParticles.minSize = 1.5;
        this.flightSmokeParticles.maxSize = 4.0;
        this.flightSmokeParticles.minEmitPower = 2;
        this.flightSmokeParticles.maxEmitPower = 5;
        this.flightSmokeParticles.updateSpeed = 0.01;
        
        this.flightSmokeParticles.direction1 = new Vector3(0, 0, -0.2);
        this.flightSmokeParticles.direction2 = new Vector3(0, 0, 0.2);
        this.flightSmokeParticles.gravity = new Vector3(0, -0.8, 0);
        this.flightSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }

    private setupExplosionEffects(): void {
        // Create procedural fire explosion texture
        const fireExplosionTexture = new DynamicTexture('iskanderFireExplosionTexture', {width: 64, height: 64}, this.scene);
        const fireExplosionContext = fireExplosionTexture.getContext();
        
        // Create fire explosion effect with bright center and fading edges
        const fireExplosionGradient = fireExplosionContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        fireExplosionGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        fireExplosionGradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.9)');
        fireExplosionGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
        fireExplosionGradient.addColorStop(0.8, 'rgba(255, 50, 0, 0.3)');
        fireExplosionGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        
        fireExplosionContext.fillStyle = fireExplosionGradient;
        fireExplosionContext.fillRect(0, 0, 64, 64);
        fireExplosionTexture.update();

        // Fire explosion particles
        this.fireParticles = new ParticleSystem('iskanderExplosionFire', 600, this.scene);
        this.fireParticles.particleTexture = fireExplosionTexture;
        this.fireParticles.emitter = this.position;
        this.fireParticles.minEmitBox = new Vector3(-1.2, 0, -1.2);
        this.fireParticles.maxEmitBox = new Vector3(1.2, 0, 1.2);
        
        this.fireParticles.color1 = new Color4(1, 0.9, 0.1, 1.0);
        this.fireParticles.color2 = new Color4(1, 0.4, 0, 1.0);
        this.fireParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
        
        this.fireParticles.minSize = 2.0;
        this.fireParticles.maxSize = 5.0;
        this.fireParticles.minLifeTime = 0.3;
        this.fireParticles.maxLifeTime = 0.6;
        this.fireParticles.emitRate = 600;
        this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.fireParticles.gravity = new Vector3(0, -5, 0);
        this.fireParticles.direction1 = new Vector3(-8, 6, -8);
        this.fireParticles.direction2 = new Vector3(8, 10, 8);
        this.fireParticles.minEmitPower = 5;
        this.fireParticles.maxEmitPower = 12;
        this.fireParticles.updateSpeed = 0.005;
        this.fireParticles.manualEmitCount = 600;
        this.fireParticles.stop();

        // Create procedural explosion smoke texture
        const explosionSmokeTexture = new DynamicTexture('iskanderExplosionSmokeTexture', {width: 64, height: 64}, this.scene);
        const explosionSmokeContext = explosionSmokeTexture.getContext();
        
        // Create explosion smoke effect with noise
        explosionSmokeContext.fillStyle = 'rgba(0, 0, 0, 0)';
        explosionSmokeContext.fillRect(0, 0, 64, 64);
        
        // Add several overlapping circles for smoke effect
        for (let i = 0; i < 8; i++) {
            const x = 32 + (Math.random() - 0.5) * 40;
            const y = 32 + (Math.random() - 0.5) * 40;
            const radius = 15 + Math.random() * 15;
            const alpha = 0.1 + Math.random() * 0.3;
            
            const gradient = explosionSmokeContext.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
            gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');
            
            explosionSmokeContext.fillStyle = gradient;
            explosionSmokeContext.beginPath();
            explosionSmokeContext.arc(x, y, radius, 0, 2 * Math.PI);
            explosionSmokeContext.fill();
        }
        explosionSmokeTexture.update();

        // Explosion smoke particles
        this.explosionSmokeParticles = new ParticleSystem('iskanderExplosionSmoke', 300, this.scene);
        this.explosionSmokeParticles.particleTexture = explosionSmokeTexture;
        this.explosionSmokeParticles.emitter = this.position;
        this.explosionSmokeParticles.minEmitBox = new Vector3(-1.5, 0, -1.5);
        this.explosionSmokeParticles.maxEmitBox = new Vector3(1.5, 0, 1.5);
        
        this.explosionSmokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.9);
        this.explosionSmokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.7);
        this.explosionSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        
        this.explosionSmokeParticles.minSize = 3.0;
        this.explosionSmokeParticles.maxSize = 8.0;
        this.explosionSmokeParticles.minLifeTime = 2.0;
        this.explosionSmokeParticles.maxLifeTime = 4.0;
        this.explosionSmokeParticles.emitRate = 300;
        this.explosionSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        this.explosionSmokeParticles.gravity = new Vector3(0, -1, 0);
        this.explosionSmokeParticles.direction1 = new Vector3(-1, 3, -1);
        this.explosionSmokeParticles.direction2 = new Vector3(1, 5, 1);
        this.explosionSmokeParticles.minEmitPower = 1;
        this.explosionSmokeParticles.maxEmitPower = 3;
        this.explosionSmokeParticles.updateSpeed = 0.01;
        this.explosionSmokeParticles.manualEmitCount = 300;
        this.explosionSmokeParticles.stop();

        // Create shockwave effect
        const shockwaveTexture = new DynamicTexture('iskanderShockwaveTexture', {width: 64, height: 64}, this.scene);
        const shockwaveContext = shockwaveTexture.getContext();
        
        // Create expanding ring effect
        const shockwaveGradient = shockwaveContext.createRadialGradient(32, 32, 0, 32, 32, 32);
        shockwaveGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        shockwaveGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        shockwaveGradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
        shockwaveGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
        
        shockwaveContext.fillStyle = shockwaveGradient;
        shockwaveContext.fillRect(0, 0, 64, 64);
        shockwaveTexture.update();

        this.shockwaveParticles = new ParticleSystem('iskanderShockwave', 150, this.scene);
        this.shockwaveParticles.particleTexture = shockwaveTexture;
        this.shockwaveParticles.emitter = this.position;
        this.shockwaveParticles.minEmitBox = new Vector3(0, 0, 0);
        this.shockwaveParticles.maxEmitBox = new Vector3(0, 0, 0);
        
        this.shockwaveParticles.color1 = new Color4(1, 1, 1, 0.8);
        this.shockwaveParticles.color2 = new Color4(1, 0.8, 0.4, 0.6);
        this.shockwaveParticles.colorDead = new Color4(1, 0.6, 0.2, 0.0);
        
        this.shockwaveParticles.minSize = 6.0;
        this.shockwaveParticles.maxSize = 12.0;
        this.shockwaveParticles.minLifeTime = 0.6;
        this.shockwaveParticles.maxLifeTime = 1.0;
        this.shockwaveParticles.emitRate = 150;
        this.shockwaveParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.shockwaveParticles.gravity = new Vector3(0, 0, 0);
        this.shockwaveParticles.direction1 = new Vector3(-0.5, 0, -0.5);
        this.shockwaveParticles.direction2 = new Vector3(0.5, 0, 0.5);
        this.shockwaveParticles.minEmitPower = 15;
        this.shockwaveParticles.maxEmitPower = 25;
        this.shockwaveParticles.manualEmitCount = 150;
        this.shockwaveParticles.stop();

        // Create spark effect
        const sparkTexture = new DynamicTexture('iskanderSparkTexture', {width: 32, height: 32}, this.scene);
        const sparkContext = sparkTexture.getContext();
        
        // Create bright spark effect
        const sparkGradient = sparkContext.createRadialGradient(16, 16, 0, 16, 16, 16);
        sparkGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        sparkGradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.8)');
        sparkGradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
        sparkGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
        
        sparkContext.fillStyle = sparkGradient;
        sparkContext.fillRect(0, 0, 32, 32);
        sparkTexture.update();

        this.sparkParticles = new ParticleSystem('iskanderSparks', 100, this.scene);
        this.sparkParticles.particleTexture = sparkTexture;
        this.sparkParticles.emitter = this.position;
        this.sparkParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        this.sparkParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        
        this.sparkParticles.color1 = new Color4(1, 1, 0.8, 1.0);
        this.sparkParticles.color2 = new Color4(1, 0.8, 0.4, 0.8);
        this.sparkParticles.colorDead = new Color4(1, 0.6, 0.2, 0.0);
        
        this.sparkParticles.minSize = 0.5;
        this.sparkParticles.maxSize = 1.5;
        this.sparkParticles.minLifeTime = 0.5;
        this.sparkParticles.maxLifeTime = 1.0;
        this.sparkParticles.emitRate = 100;
        this.sparkParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.sparkParticles.gravity = new Vector3(0, -10, 0);
        this.sparkParticles.direction1 = new Vector3(-8, 5, -8);
        this.sparkParticles.direction2 = new Vector3(8, 8, 8);
        this.sparkParticles.minEmitPower = 10;
        this.sparkParticles.maxEmitPower = 20;
        this.sparkParticles.manualEmitCount = 100;
        this.sparkParticles.stop();
    }

    public launch(): void {
        if (this.launched) return;
        
        this.launched = true;
        
        // Start all particle effects
        this.exhaustParticles.start();
        this.trailParticles.start();
        this.flightSmokeParticles.start();
    }

    public addFlareTarget(flarePosition: Vector3): void {
        this.flareTargets.push(flarePosition.clone());
    }

    private checkForFlareTargets(): void {
        // Check if any flares are within detection range
        for (let i = 0; i < this.flareTargets.length; i++) {
            const flarePos = this.flareTargets[i];
            const distanceToFlare = Vector3.Distance(this.position, flarePos);
            
            if (distanceToFlare <= this.flareDetectionRange) {
                // Switch to targeting this flare
                this.targetPosition = flarePos.clone();
                this.isTargetingFlare = true;
                this.currentTargetIndex = i;
                return;
            }
        }
        
        // If no flares in range, return to original target (bomber)
        if (this.isTargetingFlare) {
            this.targetPosition = this.originalTargetPosition.clone();
            this.isTargetingFlare = false;
        }
    }

    public update(deltaTime: number): void {
        if (!this.launched || this.exploded) return;

        // Performance optimization: limit update frequency
        const currentTime = performance.now() / 1000;
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = currentTime;

        // Update target position periodically for better performance
        if (currentTime - this.lastTargetUpdateTime > this.targetUpdateInterval) {
            this.targetPosition = this.bomber.getPosition().clone();
            this.lastTargetUpdateTime = currentTime;
        }

        // Check for flare targets
        this.checkForFlareTargets();

        // Lock-on system
        this.updateLockOnSystem(deltaTime);

        // Update missile guidance based on lock status
        if (this.isLockedOn) {
            this.updateLockedOnGuidance(deltaTime);
        } else {
            this.updateInitialGuidance(deltaTime);
        }
        
        // Update rotation based on velocity
        if (this.velocity.lengthSquared() > 0.01) {
            // Calculate yaw (horizontal rotation around Y axis)
            this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
            
            // Calculate pitch (vertical rotation around X axis)
            const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            if (horizontalSpeed > 0.001) {
                this.rotation.x = Math.atan2(-this.velocity.y, horizontalSpeed);
            } else {
                this.rotation.x = 0;
            }
        }

        // Update position
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
        this.position.z += this.velocity.z * deltaTime;
        this.missileGroup.position = this.position.clone();
        this.missileGroup.rotation = this.rotation.clone();

        // Check if reached target or ground
        const distanceToTarget = Vector3.Distance(this.position, this.targetPosition);
        if (distanceToTarget <= 5 || this.position.y <= 0) {
            this.explode();
        }
    }

    private updateLockOnSystem(deltaTime: number): void {
        const distanceToTarget = Vector3.Distance(this.position, this.targetPosition);
        
        if (distanceToTarget <= this.lockOnRange) {
            if (!this.isLockedOn) {
                this.lockOnTime += deltaTime;
                if (this.lockOnTime >= this.lockOnDuration) {
                    this.isLockedOn = true;
                    // Notify that lock has been established
                    this.onLockEstablished();
                }
            }
        } else {
            // Reset lock if target is out of range
            this.isLockedOn = false;
            this.lockOnTime = 0;
        }
    }

    private updateLockedOnGuidance(deltaTime: number): void {
        // Calculate direction to target
        const directionToTarget = this.targetPosition.subtract(this.position).normalize();
        
        // Calculate desired velocity toward target
        const desiredVelocity = directionToTarget.scale(this.speed);
        
        // Calculate velocity change needed
        const velocityChange = desiredVelocity.subtract(this.velocity);
        
        // Apply guidance with turn rate limiting
        const maxVelocityChange = this.maxTurnRate * this.speed * deltaTime;
        const velocityChangeMagnitude = velocityChange.length();
        
        if (velocityChangeMagnitude > maxVelocityChange) {
            velocityChange.normalize().scaleInPlace(maxVelocityChange);
        }
        
        // Apply guidance strength
        velocityChange.scaleInPlace(this.guidanceStrength * deltaTime);
        
        // Update velocity
        this.velocity.addInPlace(velocityChange);
        
        // Ensure velocity doesn't exceed maximum speed
        if (this.velocity.length() > this.speed) {
            this.velocity.normalize().scaleInPlace(this.speed);
        }
    }

    private updateInitialGuidance(deltaTime: number): void {
        // Initial guidance before lock-on - follow a ballistic trajectory toward target
        const directionToTarget = this.targetPosition.subtract(this.position).normalize();
        const desiredVelocity = directionToTarget.scale(this.speed);
        
        // Gradually turn toward target
        const turnRate = this.maxTurnRate * 0.5; // Slower initial turn rate
        const velocityChange = desiredVelocity.subtract(this.velocity);
        const maxVelocityChange = turnRate * this.speed * deltaTime;
        
        if (velocityChange.length() > maxVelocityChange) {
            velocityChange.normalize().scaleInPlace(maxVelocityChange);
        }
        
        this.velocity.addInPlace(velocityChange);
        
        // Ensure velocity doesn't exceed maximum speed
        if (this.velocity.length() > this.speed) {
            this.velocity.normalize().scaleInPlace(this.speed);
        }
    }

    private onLockEstablished(): void {
        // This will be called when the missile establishes lock
        // The Game class will handle the alert notification
        if (this.onLockEstablishedCallback) {
            this.onLockEstablishedCallback();
        }
    }

    public explode(): void {
        if (this.exploded) return;
        
        this.exploded = true;
        
        // Stop flight effects
        this.exhaustParticles.stop();
        this.trailParticles.stop();
        this.flightSmokeParticles.stop();
        this.light.setEnabled(false);
        
        // Start explosion effects
        this.fireParticles.emitter = this.position;
        this.explosionSmokeParticles.emitter = this.position;
        this.shockwaveParticles.emitter = this.position;
        this.sparkParticles.emitter = this.position;
        
        this.fireParticles.start();
        this.explosionSmokeParticles.start();
        this.shockwaveParticles.start();
        this.sparkParticles.start();
        
        // Deal damage to bomber if close enough
        const bomberPosition = this.bomber.getPosition();
        const distanceToBomber = Vector3.Distance(this.position, bomberPosition);
        if (distanceToBomber <= 25) {
            const damage = Math.max(10, 30 - distanceToBomber); // 30% of bomber health
            this.bomber.takeDamage(damage);
        }
        
        // Hide missile model
        this.fuselage.setEnabled(false);
        
        // Clean up after explosion
        setTimeout(() => {
            this.fireParticles.dispose();
            this.trailParticles.dispose();
            this.exhaustParticles.dispose();
            this.shockwaveParticles.dispose();
            this.sparkParticles.dispose();
        }, 1000);
        
        setTimeout(() => {
            this.explosionSmokeParticles.dispose();
        }, 6000);
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

    public getIsLockedOn(): boolean {
        return this.isLockedOn;
    }

    public getLockProgress(): number {
        return Math.min(this.lockOnTime / this.lockOnDuration, 1.0);
    }

    public getLockOnRange(): number {
        return this.lockOnRange;
    }

    public dispose(): void {
        if (this.missileGroup) this.missileGroup.dispose();
        if (this.fireParticles) this.fireParticles.dispose();
        if (this.explosionSmokeParticles) this.explosionSmokeParticles.dispose();
        if (this.trailParticles) this.trailParticles.dispose();
        if (this.exhaustParticles) this.exhaustParticles.dispose();
        if (this.shockwaveParticles) this.shockwaveParticles.dispose();
        if (this.sparkParticles) this.sparkParticles.dispose();
        if (this.light) this.light.dispose();
    }

    public setOnLockEstablishedCallback(callback: () => void): void {
        this.onLockEstablishedCallback = callback;
    }
}
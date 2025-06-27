import { Scene, Mesh, Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Sound, Color4, PointLight, TransformNode, Animation, AnimationGroup } from '@babylonjs/core';
import { Building } from './Building';

export class TomahawkMissile {
    private scene: Scene;
    private missileGroup: TransformNode;
    private fuselage!: Mesh;
    private position: Vector3;
    private velocity: Vector3;
    private rotation: Vector3;
    private targetPosition: Vector3;
    private targetBuilding: Building | null = null;
    private speed: number = 150; // Cruise missile speed
    private turnRate: number = 2.0; // How fast the missile can turn
    private launched: boolean = false;
    private exploded: boolean = false;
    private exhaustParticles!: ParticleSystem;
    private trailParticles!: ParticleSystem;
    private flightSmokeParticles!: ParticleSystem;
    private fireParticles!: ParticleSystem;
    private explosionSmokeParticles!: ParticleSystem;
    private explosionSound!: Sound;
    private light!: PointLight;
    private launchAnimationGroup!: AnimationGroup;
    
    // Curved path navigation properties
    private pathProgress: number = 0;
    private pathDuration: number = 8; // Time to reach target in seconds
    private pathStartTime: number = 0;
    private waypoints: Vector3[] = [];
    private currentWaypointIndex: number = 0;
    private waypointReachedDistance: number = 10;
    
    // Simple curved path following
    private pathTime: number = 0;
    private pathSpeed: number = 0.5; // Speed along the curved path

    // Performance optimization: cached calculations
    private lastUpdateTime: number = 0;
    private updateInterval: number = 1/60; // 60 FPS max updates
    private cachedCurvePosition: Vector3 = new Vector3();
    private curveCacheValid: boolean = false;
    private lastCurveTime: number = -1;

    constructor(scene: Scene, launchPosition: Vector3, targetBuilding: Building, launchRotation: Vector3) {
        this.scene = scene;
        this.position = launchPosition.clone();
        this.targetBuilding = targetBuilding;
        this.targetPosition = targetBuilding.getPosition().clone();
        this.rotation = launchRotation.clone();
        this.velocity = new Vector3(0, 0, 0); // Start stationary
        
        this.missileGroup = new TransformNode('tomahawkGroup', this.scene);
        this.missileGroup.position = this.position.clone();
        this.missileGroup.rotation = this.rotation.clone();
        
        this.createMissileModel();
        this.setupParticleEffects();
        this.setupExplosionEffects();
        this.createLaunchAnimation();
        this.generateCurvedPath();
    }

    private generateCurvedPath(): void {
        // Simple curved path - just store start and end points
        this.waypoints = [this.position.clone(), this.targetPosition.clone()];
    }

    private getCurvedPathPosition(t: number): Vector3 {
        // Use cached result if available
        if (this.curveCacheValid && Math.abs(t - this.lastCurveTime) < 0.01) {
            return this.cachedCurvePosition.clone();
        }

        // Create a simple curved path using parametric equations
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
        const curveY = Math.sin(t * Math.PI) * 50; // Height variation
        
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
        // Main fuselage - sleek cruise missile body
        this.fuselage = MeshBuilder.CreateCylinder('missileFuselage', {
            height: 6,
            diameter: 0.4,
            tessellation: 8
        }, this.scene);
        
        this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally pointing forward
        this.fuselage.parent = this.missileGroup;
        
        const fuselageMaterial = new StandardMaterial('missileFuselage', this.scene);
        fuselageMaterial.diffuseColor = new Color3(0.8, 0.8, 0.9); // Light gray
        fuselageMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
        fuselageMaterial.emissiveColor = new Color3(0.1, 0.1, 0.12);
        this.fuselage.material = fuselageMaterial;

        // Nose cone
        const noseCone = MeshBuilder.CreateCylinder('noseCone', {
            height: 1.5,
            diameterTop: 0,
            diameterBottom: 0.4,
            tessellation: 8
        }, this.scene);
        
        noseCone.position.z = 3.75; // Front of missile
        noseCone.rotation.x = Math.PI / 2;
        noseCone.parent = this.missileGroup;
        
        const noseMaterial = new StandardMaterial('noseMaterial', this.scene);
        noseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.25);
        noseMaterial.specularColor = new Color3(0.8, 0.8, 0.9);
        noseCone.material = noseMaterial;

        // Wings - small control surfaces
        this.createWings();
        
        // Engine nozzle
        const engineNozzle = MeshBuilder.CreateCylinder('engineNozzle', {
            height: 1,
            diameter: 0.3,
            tessellation: 8
        }, this.scene);
        
        engineNozzle.position.z = -3.5; // Rear of missile
        engineNozzle.rotation.x = Math.PI / 2;
        engineNozzle.parent = this.missileGroup;
        
        const engineMaterial = new StandardMaterial('engineMaterial', this.scene);
        engineMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
        engineMaterial.emissiveColor = new Color3(0.3, 0.1, 0.05);
        engineNozzle.material = engineMaterial;

        // Add missile light with enhanced glow
        this.light = new PointLight('missileLight', new Vector3(0, 0, 0), this.scene);
        this.light.diffuse = new Color3(1, 0.3, 0);
        this.light.specular = new Color3(1, 0.3, 0);
        this.light.intensity = 3; // Increased intensity
        this.light.range = 80; // Increased range for more dramatic effect
        this.light.parent = this.missileGroup;
    }

    private createWings(): void {
        // Small control fins
        const wingPositions = [
            { pos: new Vector3(0, 0.3, 0), rot: new Vector3(0, 0, 0) },
            { pos: new Vector3(0, -0.3, 0), rot: new Vector3(0, 0, Math.PI) },
            { pos: new Vector3(0, 0, 0.3), rot: new Vector3(0, 0, Math.PI / 2) },
            { pos: new Vector3(0, 0, -0.3), rot: new Vector3(0, 0, -Math.PI / 2) }
        ];

        wingPositions.forEach((wingData, index) => {
            const wing = MeshBuilder.CreateBox(`wing${index}`, {
                width: 0.05,
                height: 1.5,
                depth: 0.6
            }, this.scene);

            wing.position = wingData.pos;
            wing.rotation = wingData.rot;
            wing.parent = this.missileGroup;

            const wingMaterial = new StandardMaterial(`wingMaterial${index}`, this.scene);
            wingMaterial.diffuseColor = new Color3(0.7, 0.7, 0.8);
            wingMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
            wing.material = wingMaterial;
        });
    }

    private setupParticleEffects(): void {
        // Optimized engine exhaust particles - reduced count and complexity
        this.exhaustParticles = new ParticleSystem('missileExhaust', 80, this.scene); // Reduced from 150
        this.exhaustParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        // Create emitter at rear of missile
        const emitterMesh = MeshBuilder.CreateSphere('missileEmitter', { diameter: 0.1 }, this.scene);
        emitterMesh.position = new Vector3(0, 0, -4); // Rear of missile
        emitterMesh.parent = this.missileGroup;
        emitterMesh.isVisible = false;
        
        this.exhaustParticles.emitter = emitterMesh;
        this.exhaustParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        this.exhaustParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // More dramatic exhaust colors
        this.exhaustParticles.color1 = new Color4(1, 0.4, 0.1, 1.0); // Bright orange
        this.exhaustParticles.color2 = new Color4(1, 0.2, 0.05, 0.9); // Deep orange
        this.exhaustParticles.colorDead = new Color4(0.3, 0.1, 0.02, 0.1);
        
        this.exhaustParticles.emitRate = 80; // Reduced from 150
        this.exhaustParticles.minLifeTime = 0.3;
        this.exhaustParticles.maxLifeTime = 0.6;
        this.exhaustParticles.minSize = 0.3;
        this.exhaustParticles.maxSize = 1.2;
        this.exhaustParticles.minEmitPower = 40;
        this.exhaustParticles.maxEmitPower = 70;
        this.exhaustParticles.updateSpeed = 0.01;
        
        this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
        this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
        this.exhaustParticles.gravity = new Vector3(0, 0, 0);
        this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        // Optimized vapor trail particles - reduced count
        this.trailParticles = new ParticleSystem('missileTrail', 150, this.scene); // Reduced from 300
        this.trailParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/flare.png', this.scene);
        this.trailParticles.emitter = emitterMesh;
        this.trailParticles.minEmitBox = new Vector3(0, 0, 0);
        this.trailParticles.maxEmitBox = new Vector3(0, 0, 0);
        
        // More distinct trail colors with blue-white tint
        this.trailParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.6); // Bright blue-white
        this.trailParticles.color2 = new Color4(0.6, 0.7, 0.9, 0.4); // Medium blue
        this.trailParticles.colorDead = new Color4(0.2, 0.3, 0.5, 0.0);
        
        this.trailParticles.emitRate = 80; // Reduced from 120
        this.trailParticles.minLifeTime = 1.5;
        this.trailParticles.maxLifeTime = 3.0;
        this.trailParticles.minSize = 0.8;
        this.trailParticles.maxSize = 2.5;
        this.trailParticles.minEmitPower = 2;
        this.trailParticles.maxEmitPower = 5;
        this.trailParticles.updateSpeed = 0.01;
        
        this.trailParticles.direction1 = new Vector3(0, 0, -0.2);
        this.trailParticles.direction2 = new Vector3(0, 0, 0.2);
        this.trailParticles.gravity = new Vector3(0, -1, 0);
        this.trailParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        // Optimized smoke trail - reduced count
        this.flightSmokeParticles = new ParticleSystem('missileSmoke', 50, this.scene); // Reduced from 100
        this.flightSmokeParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/explosion/Smoke_11.png', this.scene);
        this.flightSmokeParticles.emitter = emitterMesh;
        this.flightSmokeParticles.minEmitBox = new Vector3(0, 0, 0);
        this.flightSmokeParticles.maxEmitBox = new Vector3(0, 0, 0);
        
        this.flightSmokeParticles.color1 = new Color4(0.4, 0.4, 0.4, 0.3);
        this.flightSmokeParticles.color2 = new Color4(0.6, 0.6, 0.6, 0.2);
        this.flightSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        
        this.flightSmokeParticles.emitRate = 30; // Reduced from 50
        this.flightSmokeParticles.minLifeTime = 2.0;
        this.flightSmokeParticles.maxLifeTime = 4.0;
        this.flightSmokeParticles.minSize = 1.0;
        this.flightSmokeParticles.maxSize = 3.0;
        this.flightSmokeParticles.minEmitPower = 1;
        this.flightSmokeParticles.maxEmitPower = 3;
        this.flightSmokeParticles.updateSpeed = 0.01;
        
        this.flightSmokeParticles.direction1 = new Vector3(0, 0, -0.1);
        this.flightSmokeParticles.direction2 = new Vector3(0, 0, 0.1);
        this.flightSmokeParticles.gravity = new Vector3(0, -0.5, 0);
        this.flightSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }

    private setupExplosionEffects(): void {
        // Optimized fire explosion particles - reduced count
        this.fireParticles = new ParticleSystem('missileExplosionFire', 1500, this.scene); // Reduced from 3000
        this.fireParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/flare.png', this.scene);
        this.fireParticles.emitter = this.position;
        this.fireParticles.minEmitBox = new Vector3(-2, 0, -2);
        this.fireParticles.maxEmitBox = new Vector3(2, 0, 2);
        
        this.fireParticles.color1 = new Color4(1, 0.9, 0.1, 1.0);
        this.fireParticles.color2 = new Color4(1, 0.4, 0, 1.0);
        this.fireParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
        
        this.fireParticles.minSize = 3.0;
        this.fireParticles.maxSize = 8.0;
        this.fireParticles.minLifeTime = 0.4;
        this.fireParticles.maxLifeTime = 0.8;
        this.fireParticles.emitRate = 1500; // Reduced from 3000
        this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.fireParticles.gravity = new Vector3(0, -5, 0);
        this.fireParticles.direction1 = new Vector3(-15, 10, -15);
        this.fireParticles.direction2 = new Vector3(15, 15, 15);
        this.fireParticles.minEmitPower = 8;
        this.fireParticles.maxEmitPower = 20;
        this.fireParticles.updateSpeed = 0.005;
        this.fireParticles.manualEmitCount = 1500; // Reduced from 3000
        this.fireParticles.stop();

        // Optimized explosion smoke - reduced count
        this.explosionSmokeParticles = new ParticleSystem('missileExplosionSmoke', 800, this.scene); // Reduced from 1500
        this.explosionSmokeParticles.particleTexture = new Texture('https://raw.githubusercontent.com/BabylonJS/Particles/master/assets/textures/explosion/Smoke_11.png', this.scene);
        this.explosionSmokeParticles.emitter = this.position;
        this.explosionSmokeParticles.minEmitBox = new Vector3(-3, 0, -3);
        this.explosionSmokeParticles.maxEmitBox = new Vector3(3, 0, 3);
        
        this.explosionSmokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.9);
        this.explosionSmokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.7);
        this.explosionSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
        
        this.explosionSmokeParticles.minSize = 6.0;
        this.explosionSmokeParticles.maxSize = 15.0;
        this.explosionSmokeParticles.minLifeTime = 3.0;
        this.explosionSmokeParticles.maxLifeTime = 6.0;
        this.explosionSmokeParticles.emitRate = 800; // Reduced from 1500
        this.explosionSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        this.explosionSmokeParticles.gravity = new Vector3(0, -1, 0);
        this.explosionSmokeParticles.direction1 = new Vector3(-2, 5, -2);
        this.explosionSmokeParticles.direction2 = new Vector3(2, 8, 2);
        this.explosionSmokeParticles.minEmitPower = 2;
        this.explosionSmokeParticles.maxEmitPower = 5;
        this.explosionSmokeParticles.updateSpeed = 0.01;
        this.explosionSmokeParticles.manualEmitCount = 800; // Reduced from 1500
        this.explosionSmokeParticles.stop();

        // Explosion sound
        this.explosionSound = new Sound('missileExplosionSound', 'https://assets.babylonjs.com/sound/explosion.mp3', this.scene);
    }

    private createLaunchAnimation(): void {
        // Create launch animation that moves missile from launcher to flight path
        const launchAnimation = new Animation('missileLaunch', 'position.y', 30, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        
        // Start slightly below launch position, then accelerate forward
        const keys = [
            { frame: 0, value: this.position.clone() },
            { frame: 15, value: this.position.add(new Vector3(0, -2, 0)) }, // Drop slightly
            { frame: 30, value: this.position.add(new Vector3(15, 0, 15)) } // Accelerate forward
        ];
        
        launchAnimation.setKeys(keys);
        
        this.launchAnimationGroup = new AnimationGroup('missileLaunchGroup');
        this.launchAnimationGroup.addTargetedAnimation(launchAnimation, this.missileGroup);
    }

    public launch(): void {
        if (this.launched) return;
        
        this.launched = true;
        this.pathStartTime = performance.now() / 1000;
        
        // Start all particle effects
        this.exhaustParticles.start();
        this.trailParticles.start();
        this.flightSmokeParticles.start();
        
        // Play launch animation
        this.launchAnimationGroup.play(false);
        
        // After launch animation, start guided flight
        setTimeout(() => {
            this.startGuidedFlight();
        }, 1000);
    }

    private startGuidedFlight(): void {
        // Calculate initial velocity toward first point on the curve
        const firstCurvePoint = this.getCurvedPathPosition(0.1);
        const directionToCurve = firstCurvePoint.subtract(this.position).normalize();
        this.velocity = directionToCurve.scale(this.speed);
    }

    public update(deltaTime: number): void {
        if (!this.launched || this.exploded) return;

        // Performance optimization: limit update frequency
        const currentTime = performance.now() / 1000;
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = currentTime;

        // Update curved path navigation
        this.pathTime += deltaTime * this.pathSpeed;
        
        if (this.pathTime <= 1.0) {
            // Follow the curved path
            const targetPosition = this.getCurvedPathPosition(this.pathTime);
            const directionToTarget = targetPosition.subtract(this.position).normalize();
            const desiredVelocity = directionToTarget.scale(this.speed);
            
            // Smoothly interpolate velocity for curved movement
            this.velocity.x = this.velocity.x + (desiredVelocity.x - this.velocity.x) * this.turnRate * deltaTime;
            this.velocity.y = this.velocity.y + (desiredVelocity.y - this.velocity.y) * this.turnRate * deltaTime;
            this.velocity.z = this.velocity.z + (desiredVelocity.z - this.velocity.z) * this.turnRate * deltaTime;
        } else {
            // Head directly to target when curve is complete
            const directionToTarget = this.targetPosition.subtract(this.position).normalize();
            this.velocity = directionToTarget.scale(this.speed);
        }

        // Update rotation to match velocity direction for smooth curved flight
        if (this.velocity.lengthSquared() > 0.01) {
            // Calculate yaw (horizontal rotation around Y axis)
            this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
            
            // Calculate pitch (vertical rotation around X axis) 
            const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            this.rotation.x = Math.atan2(this.velocity.y, horizontalSpeed);
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
        this.fireParticles.start();
        this.explosionSmokeParticles.start();
        this.explosionSound.play();
        
        // Destroy the target building if it exists and is close enough
        if (this.targetBuilding && Vector3.Distance(this.position, this.targetBuilding.getPosition()) <= 20) {
            this.targetBuilding.takeDamage(100); // Destroy building instantly
        }
        
        // Hide missile model
        this.fuselage.setEnabled(false);
        
        // Clean up after explosion - reduced cleanup time
        setTimeout(() => {
            this.fireParticles.dispose();
            this.trailParticles.dispose();
            this.exhaustParticles.dispose();
        }, 1000); // Reduced from 1500
        
        setTimeout(() => {
            this.explosionSmokeParticles.dispose();
        }, 6000); // Reduced from 8000
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
        if (this.missileGroup) this.missileGroup.dispose();
        if (this.fireParticles) this.fireParticles.dispose();
        if (this.explosionSmokeParticles) this.explosionSmokeParticles.dispose();
        if (this.trailParticles) this.trailParticles.dispose();
        if (this.exhaustParticles) this.exhaustParticles.dispose();
        if (this.explosionSound) this.explosionSound.dispose();
        if (this.light) this.light.dispose();
        if (this.launchAnimationGroup) this.launchAnimationGroup.dispose();
    }
} 
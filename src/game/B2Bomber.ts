import { Scene, Mesh, Vector3, Color3, Color4, StandardMaterial, MeshBuilder, TransformNode, ParticleSystem, Texture, Animation } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TomahawkMissile } from './TomahawkMissile';
import { TerrainManager } from './TerrainManager';
import { Building } from './Building';

export class B2Bomber {
    private scene: Scene;
    private bomberGroup!: TransformNode;
    private position: Vector3;
    private rotation: Vector3;
    private velocity: Vector3;
    private speed: number = 25; // Units per second
    private altitude: number = 100; // Restored original altitude
    private turnSpeed: number = 0.5; // Radians per second
    private climbRate: number = 20; // Units per second
    private particleSystems: ParticleSystem[] = []; // Engine exhaust particle systems
    private bombBayLeft!: Mesh;
    private bombBayRight!: Mesh;
    
    // Banking/roll properties for realistic turning
    private maxBankAngle: number = Math.PI / 6; // 30 degrees max bank (symmetric)
    private maxClimbBankAngle: number = Math.PI / 12; // 15 degrees for altitude changes (symmetric)
    private bankSpeed: number = 2.5; // How quickly the bomber banks into turns (slightly faster for responsiveness)
    private currentBankAngle: number = 0; // Current roll angle
    private targetBankAngle: number = 0; // Target roll angle
    
    // Tomahawk missile system
    private missiles: TomahawkMissile[] = [];
    private lastMissileLaunchTime: number = -Infinity;
    private missileCooldownTime: number = 10; // 10 seconds cooldown
    private terrainManager: TerrainManager | null = null; // Reference to terrain manager for targeting
    
    // Target detection caching for performance
    private cachedTarget: Building | null = null;
    private lastTargetCheckTime: number = 0;
    private targetCheckInterval: number = 0.5; // Check for targets every 0.5 seconds instead of every frame
    private lastTargetCheckPosition: Vector3 = new Vector3();
    private targetCheckPositionThreshold: number = 50; // Recheck if moved more than 50 units
    
    // Performance optimizations: cache trigonometric calculations
    private lastRotationY: number = 0;
    private cachedSinY: number = 0;
    private cachedCosY: number = 1;
    private trigCacheValid: boolean = false;
    
    // Reusable vector to avoid object creation
    private tempVector: Vector3 = new Vector3();
    private tempRotation: Vector3 = new Vector3();

    constructor(scene: Scene) {
        this.scene = scene;
        this.position = new Vector3(0, this.altitude, 0);
        this.rotation = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, this.speed);

        this.createBomberMesh();
    }

    private createBomberMesh(): void {
        this.bomberGroup = new TransformNode('bomberGroup', this.scene);
        this.bomberGroup.position = this.position.clone();

        // Create B2 bomber-like shape
        this.createFuselage();
        this.createWings();
        this.createCockpit();
        this.createEngines();
        this.createBombBay();
    }

    private createFuselage(): void {
        // Main body - diamond shaped from top view
        const fuselage = MeshBuilder.CreateBox('fuselage', {
            width: 10,
            height: 1.5,
            depth: 22
        }, this.scene);

        // Scale to make it more diamond-like
        fuselage.scaling.x = 0.4;
        fuselage.scaling.y = 0.6;
        fuselage.position.y = 0;
        fuselage.parent = this.bomberGroup;

        const fuselageMaterial = new StandardMaterial('fuselageMaterial', this.scene);
        fuselageMaterial.diffuseColor = new Color3(0.15, 0.18, 0.2);
        fuselageMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
        fuselageMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
        fuselage.material = fuselageMaterial;
    }

    private createWings(): void {
        // Main wing - triangular swept wing characteristic of B2
        const wingLeft = MeshBuilder.CreateBox('wingLeft', {
            width: 30,
            height: 0.4,
            depth: 6
        }, this.scene);

        wingLeft.position.x = -14;
        wingLeft.position.y = -0.5;
        wingLeft.position.z = -3;
        wingLeft.rotation.y = -Math.PI * 0.15; // More sweep
        wingLeft.parent = this.bomberGroup;

        const wingLeftSmall = MeshBuilder.CreateBox('wingLeftSmall', {
            width: 5,
            height: 0.4,
            depth: 3
        }, this.scene);

        wingLeftSmall.position.x = -3;
        wingLeftSmall.position.z = -10;
        wingLeftSmall.rotation.y = -Math.PI * 0.15; // More sweep
        wingLeftSmall.parent = this.bomberGroup;      

        const wingRight = MeshBuilder.CreateBox('wingRight', {
            width: 30,
            height: 0.4,
            depth: 6
        }, this.scene);

        wingRight.position.x = 14;
        wingRight.position.y = -0.5;
        wingRight.position.z = -3;
        wingRight.rotation.y = Math.PI * 0.15; // More sweep
        wingRight.parent = this.bomberGroup;

        const wingRightSmall = MeshBuilder.CreateBox('wingRightSmall', {
            width: 5,
            height: 0.4,
            depth: 3
        }, this.scene);

        wingRightSmall.position.x = 3;
        wingRightSmall.position.z = -10;
        wingRightSmall.rotation.y = Math.PI * 0.15; // More sweep
        wingRightSmall.parent = this.bomberGroup;

        const wingMaterial = new StandardMaterial('wingMaterial', this.scene);
        wingMaterial.diffuseColor = new Color3(0.12, 0.15, 0.18);
        wingMaterial.specularColor = new Color3(0.2, 0.2, 0.3);
        wingMaterial.emissiveColor = new Color3(0.04, 0.04, 0.06);
        wingLeft.material = wingMaterial;
        wingRight.material = wingMaterial;
        wingLeftSmall.material = wingMaterial;
        wingRightSmall.material = wingMaterial;
    }

    private createCockpit(): void {
        // Create a small hemisphere for the cockpit
        const cockpit = MeshBuilder.CreateSphere('cockpit', {
            diameter: 3,
            segments: 16
        }, this.scene);

        // Scale it to make it more hemisphere-like (flatten the bottom)
        cockpit.scaling.y = 0.5;
        
        // Position it on top of the fuselage, slightly forward
        cockpit.position.x = 0;
        cockpit.position.y = 0.5; // Above the fuselage
        cockpit.position.z = 9; // Forward on the fuselage
        cockpit.parent = this.bomberGroup;

        // Create cockpit material - turquoise blue with some transparency
        const cockpitMaterial = new StandardMaterial('cockpitMaterial', this.scene);
        cockpitMaterial.diffuseColor = new Color3(0.0, 0.5, 0.5);
        cockpitMaterial.specularColor = new Color3(0.2, 0.8, 0.8);
        cockpitMaterial.emissiveColor = new Color3(0.0, 0.3, 0.3);
        cockpitMaterial.alpha = 0.8; // Slightly transparent for glass effect
        cockpit.material = cockpitMaterial;
    }

    private createBombBay(): void {
        const bayMaterial = new StandardMaterial('bayMaterial', this.scene);
        bayMaterial.diffuseColor = new Color3(0.1, 0.1, 0.12);

        this.bombBayLeft = MeshBuilder.CreateBox('bombBayLeft', { width: 1.8, height: 0.2, depth: 8 }, this.scene);
        this.bombBayLeft.position = new Vector3(-1, 0, -10);
        this.bombBayLeft.parent = this.bomberGroup;
        this.bombBayLeft.material = bayMaterial;
        this.bombBayLeft.rotation.x = 0;

        this.bombBayRight = MeshBuilder.CreateBox('bombBayRight', { width: 1.8, height: 0.2, depth: 8 }, this.scene);
        this.bombBayRight.position = new Vector3(1, 0, -10);
        this.bombBayRight.parent = this.bomberGroup;
        this.bombBayRight.material = bayMaterial;
        this.bombBayRight.rotation.x = 0;
    }

    private createEngines(): void {
        // Engine nacelles embedded in wings
        const positions = [
            new Vector3(-10, -0.8, -3),
            new Vector3(-19, -0.8, -7),
            new Vector3(10, -0.8, -3),
            new Vector3(19, -0.8, -7)
        ];

        positions.forEach((pos, index) => {
            const engine = MeshBuilder.CreateCylinder(`engine${index}`, {
                height: 6,
                diameter: 2
            }, this.scene);

            engine.position = pos;
            engine.rotation.x = Math.PI / 2;
            engine.parent = this.bomberGroup;

            const engineMaterial = new StandardMaterial(`engineMaterial${index}`, this.scene);
            engineMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Very dark
            engine.material = engineMaterial;

            // Add exhaust effect
            const exhaust = MeshBuilder.CreateCylinder(`exhaust${index}`, {
                height: 3,
                diameter: 1.5
            }, this.scene);

            exhaust.position = pos.add(new Vector3(0, 0, -4));
            exhaust.rotation.x = Math.PI / 2;
            exhaust.parent = this.bomberGroup;

            const exhaustMaterial = new StandardMaterial(`exhaustMaterial${index}`, this.scene);
            exhaustMaterial.diffuseColor = new Color3(0.3, 0.1, 0.05); // Dark reddish
            exhaustMaterial.emissiveColor = new Color3(0.2, 0.05, 0.01); // Glowing effect
            exhaust.material = exhaustMaterial;

            // Create particle system for engine exhaust
            this.createEngineParticleSystem(pos, index);
        });
    }

    private createEngineParticleSystem(enginePos: Vector3, index: number): void {
        const particleSystem = new ParticleSystem(`engineExhaust${index}`, 50, this.scene);
        
        // Create a simple particle texture - using a basic white texture
        particleSystem.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        // Create a dummy mesh as emitter at the exact engine exhaust position
        const emitterMesh = MeshBuilder.CreateSphere(`emitter${index}`, { diameter: 0.1 }, this.scene);
        emitterMesh.position = enginePos.add(new Vector3(0, 0, -3)); // Closer to engine, less offset
        emitterMesh.parent = this.bomberGroup;
        emitterMesh.isVisible = false; // Hide the emitter mesh
        
        // Configure particle emitter - horizontal emit box only
        particleSystem.emitter = emitterMesh;
        particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2); // No downward component (Y=0)
        particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);   // No upward component (Y=0)
        
        // Particle properties for visible exhaust trail
        particleSystem.color1 = new Color4(0.8, 0.4, 0.2, 1.0); // Bright orange
        particleSystem.color2 = new Color4(0.6, 0.3, 0.1, 0.8); // Orange-brown
        particleSystem.colorDead = new Color4(0.2, 0.1, 0.05, 0.1); // Dark with low alpha
        
        // Emission rate and lifetime - quick disappearing trails
        particleSystem.emitRate = 50; // Higher emission rate for better visibility
        particleSystem.minLifeTime = 0.1; // Very short lived particles
        particleSystem.maxLifeTime = 0.3; // Quick disappearance
        
        // Size - slightly larger particles for visibility
        particleSystem.minSize = 0.4;
        particleSystem.maxSize = 1.0;
        
        // Speed and direction - emit fast and straight
        particleSystem.minEmitPower = 20;
        particleSystem.maxEmitPower = 30;
        particleSystem.updateSpeed = 0.02;
        
        // Set fixed backward direction in local space - this will rotate with the emitter
        particleSystem.direction1 = new Vector3(-0.02, 0.1, -1);
        particleSystem.direction2 = new Vector3(0.02, 0.1, -1);
        
        // No gravity - particles shoot straight out
        particleSystem.gravity = new Vector3(0, 0, 0);
        
        // Blend mode for visible appearance
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        // Start the particle system
        particleSystem.start();
        
        // Store reference for updates
        this.particleSystems.push(particleSystem);
    }

    public setMinimumAltitude(minAltitude: number): void {
        this.altitude = Math.max(this.altitude, minAltitude + 10); // 10 unit safety margin
    }

    public update(deltaTime: number, inputManager: InputManager): void {
        // Handle turning (left/right arrows) and banking
        // Only turn if Right Shift is NOT pressed (Right Shift + arrows is for camera panning)
        let isTurning = false;
        let isClimbing = false;
        let isDiving = false;
        
        if (inputManager.isKeyPressed('ArrowLeft') && !inputManager.isKeyPressed('ShiftRight')) {
            this.rotation.y += this.turnSpeed * deltaTime; // Left arrow turns right
            this.targetBankAngle = this.maxBankAngle; // Bank right
            isTurning = true;
            this.trigCacheValid = false; // Invalidate cache when turning
        }
        if (inputManager.isKeyPressed('ArrowRight') && !inputManager.isKeyPressed('ShiftRight')) {
            this.rotation.y -= this.turnSpeed * deltaTime; // Right arrow turns left
            this.targetBankAngle = -this.maxBankAngle; // Bank left
            isTurning = true;
            this.trigCacheValid = false; // Invalidate cache when turning
        }

        // Handle altitude changes (up/down arrows) with banking (inverted)
        // Only change altitude and bank when Shift is NOT pressed (Shift+Up/Down is for camera)
        if (inputManager.isKeyPressed('ArrowUp') && !inputManager.isShiftUpPressed()) {
            this.altitude -= this.climbRate * deltaTime; // Up arrow decreases altitude
            isDiving = true;
            // If not already turning, add slight banking for dive
            if (!isTurning) {
                this.targetBankAngle = -this.maxClimbBankAngle; // Slight left bank during dive
            }
        }
        if (inputManager.isKeyPressed('ArrowDown') && !inputManager.isShiftDownPressed()) {
            this.altitude += this.climbRate * deltaTime; // Down arrow increases altitude
            isClimbing = true;
            // If not already turning, add slight banking for climb
            if (!isTurning) {
                this.targetBankAngle = this.maxClimbBankAngle; // Slight right bank during climb
            }
        }
        
        // If not turning, climbing, or diving, return to level flight
        if (!isTurning && !isClimbing && !isDiving) {
            this.targetBankAngle = 0;
        }

        // Smoothly interpolate current bank angle toward target
        const bankDifference = this.targetBankAngle - this.currentBankAngle;
        this.currentBankAngle += bankDifference * this.bankSpeed * deltaTime;

        // Keep altitude within reasonable bounds - above terrain (max ~80) but still allow low flying
        // Minimum altitude will be dynamically set by the game based on building heights
        this.altitude = Math.max(30, Math.min(300, this.altitude));

        // Cache trigonometric calculations to avoid repeated sin/cos calls
        if (!this.trigCacheValid || Math.abs(this.rotation.y - this.lastRotationY) > 0.01) {
            this.cachedSinY = Math.sin(this.rotation.y);
            this.cachedCosY = Math.cos(this.rotation.y);
            this.lastRotationY = this.rotation.y;
            this.trigCacheValid = true;
        }

        // Update velocity based on cached rotation values
        this.velocity.x = this.cachedSinY * this.speed;
        this.velocity.z = this.cachedCosY * this.speed;

        // Update position
        this.position.x += this.velocity.x * deltaTime;
        this.position.z += this.velocity.z * deltaTime;
        this.position.y = this.altitude;

        // Update mesh position and rotation (including banking) using reusable vectors
        this.bomberGroup.position.copyFrom(this.position);
        
        // Reuse rotation vector instead of creating new one
        this.tempRotation.copyFrom(this.rotation);
        this.tempRotation.z = this.currentBankAngle; // Apply banking to Z rotation (roll)
        this.bomberGroup.rotation.copyFrom(this.tempRotation);

        // Update missiles
        this.updateMissiles(deltaTime);
    }

    public getPosition(): Vector3 {
        return this.position.clone();
    }

    public getRotation(): Vector3 {
        return this.rotation.clone();
    }

    public getVelocity(): Vector3 {
        return this.velocity.clone();
    }

    public getBombBayPosition(): Vector3 {
        return this.bomberGroup.position.add(new Vector3(0, -5, 0));
    }

    public openBombBay(): void {
        const openAnimation = new Animation('openBombBay', 'rotation.x', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keys = [
            { frame: 0, value: 0 },
            { frame: 20, value: Math.PI / 2.5 }
        ];
        openAnimation.setKeys(keys);
        this.bombBayLeft.animations.push(openAnimation);
        this.bombBayRight.animations.push(openAnimation.clone());
        this.scene.beginDirectAnimation(this.bombBayLeft, [openAnimation], 0, 20, false);
        this.scene.beginDirectAnimation(this.bombBayRight, [openAnimation], 0, 20, false);
    }

    public closeBombBay(): void {
        const closeAnimation = new Animation('closeBombBay', 'rotation.x', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keys = [
            { frame: 0, value: this.bombBayLeft.rotation.x },
            { frame: 20, value: 0 }
        ];
        closeAnimation.setKeys(keys);
        this.bombBayLeft.animations.push(closeAnimation);
        this.bombBayRight.animations.push(closeAnimation.clone());
        this.scene.beginDirectAnimation(this.bombBayLeft, [closeAnimation], 0, 20, false);
        this.scene.beginDirectAnimation(this.bombBayRight, [closeAnimation], 0, 20, false);
    }

    // Missile system methods
    public canLaunchMissile(): boolean {
        const currentTime = performance.now() / 1000;
        return (currentTime - this.lastMissileLaunchTime) >= this.missileCooldownTime;
    }

    public getMissileCooldownStatus(): number {
        const currentTime = performance.now() / 1000;
        const timeSinceLastLaunch = currentTime - this.lastMissileLaunchTime;
        return Math.min(timeSinceLastLaunch / this.missileCooldownTime, 1);
    }

    public findClosestDefenseBuilding(): Building | null {
        if (!this.terrainManager) return null;
        
        const currentTime = performance.now() / 1000;
        const distanceMoved = Vector3.Distance(this.position, this.lastTargetCheckPosition);
        
        // Use cached result if recent enough and position hasn't changed significantly
        if (this.cachedTarget && 
            (currentTime - this.lastTargetCheckTime) < this.targetCheckInterval &&
            distanceMoved < this.targetCheckPositionThreshold) {
            
            // Verify cached target is still valid
            if (!this.cachedTarget.getIsDestroyed() && 
                Vector3.Distance(this.position, this.cachedTarget.getPosition()) <= 300) {
                return this.cachedTarget;
            }
        }
        
        // Perform expensive target detection
        this.lastTargetCheckTime = currentTime;
        this.lastTargetCheckPosition.copyFrom(this.position);
        
        const defenseRange = 300; // Same range as defense buildings
        const nearbyBuildings = this.terrainManager.getBuildingsInRadius(this.position, defenseRange);
        
        let closestBuilding: Building | null = null;
        let closestDistance = Infinity;
        
        for (const building of nearbyBuildings) {
            if (building.isDefenseLauncher() && !building.getIsDestroyed()) {
                const distance = Vector3.Distance(this.position, building.getPosition());
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestBuilding = building;
                }
            }
        }
        
        this.cachedTarget = closestBuilding;
        return closestBuilding;
    }

    public hasValidTarget(): boolean {
        return this.findClosestDefenseBuilding() !== null;
    }

    public invalidateTargetCache(): void {
        this.cachedTarget = null;
        this.lastTargetCheckTime = 0;
    }

    public launchMissile(): boolean {
        if (!this.canLaunchMissile()) return false;

        // Find the closest defense building
        const targetBuilding = this.findClosestDefenseBuilding();
        if (!targetBuilding) return false; // No valid target in range

        const currentTime = performance.now() / 1000;
        this.lastMissileLaunchTime = currentTime;

        // Alternate between left and right launchers
        const useLeftLauncher = this.missiles.length % 2 === 0;
        const launcherPosition = useLeftLauncher 
            ? this.bomberGroup.position.add(new Vector3(-12, -1, 0))
            : this.bomberGroup.position.add(new Vector3(12, -1, 0));

        // Create and launch missile targeting the defense building
        const missile = new TomahawkMissile(
            this.scene,
            launcherPosition,
            targetBuilding,
            this.rotation.clone()
        );

        this.missiles.push(missile);
        missile.launch();

        return true;
    }

    private updateMissiles(deltaTime: number): void {
        // Update all missiles
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const missile = this.missiles[i];
            missile.update(deltaTime);

            // Remove missiles that have exploded and finished their effects
            if (missile.hasExploded()) {
                // Remove missile after explosion effects are done
                setTimeout(() => {
                    missile.dispose();
                    const index = this.missiles.indexOf(missile);
                    if (index > -1) {
                        this.missiles.splice(index, 1);
                    }
                }, 10000); // 10 seconds after explosion
            }
        }
    }

    public setTerrainManager(terrainManager: TerrainManager): void {
        this.terrainManager = terrainManager;
    }
} 
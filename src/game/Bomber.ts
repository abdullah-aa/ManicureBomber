import { Scene, Mesh, Vector3, Color3, Color4, StandardMaterial, MeshBuilder, TransformNode, ParticleSystem, Texture, Animation, PointLight, DynamicTexture } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TomahawkMissile } from './TomahawkMissile';
import { TerrainManager } from './TerrainManager';
import { Building } from './Building';

export class Bomber {
    private scene: Scene;
    private isBombingRunActiveCallback: (() => boolean) | null = null; // Callback to check bombing run status
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
    
    // Bomb bay state tracking
    private bombBayState: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
    private bombBayOpenProgress: number = 0; // 0 = closed, 1 = fully open
    private bombBayOpenTime: number = 1.0; // Time in seconds for doors to fully open
    private bombBayOpenStartTime: number = 0;
    private bombBayLights: PointLight[] = [];
    private bombBayParticles: ParticleSystem[] = [];
    private bombBayGlowMaterial: StandardMaterial | null = null;
    private missileLaunchPending: boolean = false; // Track if missile launch is waiting for bomb bay to open
    
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

    // Health system
    private health: number = 100;
    private maxHealth: number = 100;
    private isDestroyed: boolean = false;
    private damageEffects: ParticleSystem[] = [];
    private damageLight: PointLight | null = null;
    private lastDamageTime: number = 0;
    private damageEffectDuration: number = 2.0; // Damage effects last 2 seconds
    private onDestroyedCallback: (() => void) | null = null;

    // Countermeasure flare system
    private flareCooldown: number = 8; // 8 seconds cooldown
    private lastFlareTime: number = -Infinity;
    private activeFlares: Vector3[] = [];
    private flareLifetime: number = 5; // Flares last 5 seconds
    private flareDetectionRange: number = 80; // Range for Iskander missiles to detect flares
    private flareParticleSystems: ParticleSystem[] = []; // Visual effects for flares
    private flareMeshes: Mesh[] = []; // Visual flare meshes

    // Target destruction callback
    private onTargetDestroyedCallback: ((building: Building) => void) | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
        this.position = new Vector3(0, this.altitude, 0);
        this.rotation = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, this.speed);

        this.createBomberMesh();
        this.setupDamageEffects();
    }

    private createBomberMesh(): void {
        this.bomberGroup = new TransformNode('bomberGroup', this.scene);
        this.bomberGroup.position = this.position.clone();

        // Create bomber-like shape
        this.createFuselage();
        this.createWings();
        this.createCockpit();
        this.createEngines();
        this.createBombBay();
    }

    private createFuselage(): void {
        // Main body - cylindrical shape instead of box
        const fuselage = MeshBuilder.CreateCylinder('fuselage', {
            height: 22,
            diameter: 3,
            tessellation: 16
        }, this.scene);

        fuselage.rotation.x = Math.PI / 2; // Orient horizontally
        fuselage.position.y = 0;
        fuselage.parent = this.bomberGroup;

        const fuselageMaterial = new StandardMaterial('fuselageMaterial', this.scene);
        fuselageMaterial.diffuseColor = new Color3(0.15, 0.18, 0.2);
        fuselageMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
        fuselageMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
        fuselage.material = fuselageMaterial;

        // Conical nose cone
        const noseCone = MeshBuilder.CreateCylinder('noseCone', {
            height: 6,
            diameterTop: 0,
            diameterBottom: 3,
            tessellation: 16
        }, this.scene);

        noseCone.rotation.x = Math.PI / 2; // Orient horizontally
        noseCone.position.z = 14; // Front of fuselage
        noseCone.parent = this.bomberGroup;

        const noseMaterial = new StandardMaterial('noseMaterial', this.scene);
        noseMaterial.diffuseColor = new Color3(0.12, 0.15, 0.18); // Slightly darker than fuselage
        noseMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
        noseMaterial.emissiveColor = new Color3(0.03, 0.03, 0.05);
        noseCone.material = noseMaterial;
    }

    private createWings(): void {
        // Main wing - triangular swept wing characteristic of stealth bomber
        const wingLeft = MeshBuilder.CreateBox('wingLeft', {
            width: 30,
            height: 0.4,
            depth: 6
        }, this.scene);

        wingLeft.position.x = -13;
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

        wingRight.position.x = 13;
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

        const topWingSmall = MeshBuilder.CreateBox('topWingSmall', {
            width: 5,
            height: 0.4,
            depth: 3
        }, this.scene);
        
        topWingSmall.position.x = 0;
        topWingSmall.position.z = -10;
        topWingSmall.position.y = 2;
        topWingSmall.rotation.z = Math.PI / 2;
        topWingSmall.rotation.x = -Math.PI / 4;
        topWingSmall.parent = this.bomberGroup;

        const wingMaterial = new StandardMaterial('wingMaterial', this.scene);
        wingMaterial.diffuseColor = new Color3(0.12, 0.15, 0.18);
        wingMaterial.specularColor = new Color3(0.2, 0.2, 0.3);
        wingMaterial.emissiveColor = new Color3(0.04, 0.04, 0.06);
        wingLeft.material = wingMaterial;
        wingRight.material = wingMaterial;
        wingLeftSmall.material = wingMaterial;
        wingRightSmall.material = wingMaterial;
        topWingSmall.material = wingMaterial;
    }

    private createCockpit(): void {
        // Create a small hemisphere for the cockpit
        const cockpit = MeshBuilder.CreateSphere('cockpit', {
            diameter: 2,
            segments: 16
        }, this.scene);

        // Scale it to make it more hemisphere-like (flatten the bottom)
        cockpit.scaling.y = 0.5;
        
        // Position it on top of the cylindrical fuselage, slightly forward
        cockpit.position.x = 0;
        cockpit.position.y = 1.2; // Above the cylindrical fuselage (radius is 1.5)
        cockpit.position.z = 11; // Forward on the fuselage, but not as far as before
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
        bayMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
        bayMaterial.emissiveColor = new Color3(0.02, 0.02, 0.03);

        // Create bomb bay doors that open outward and downward
        // Left door - positioned on the left side of the cylindrical fuselage
        this.bombBayLeft = MeshBuilder.CreateBox('bombBayLeft', { width: 2.0, height: 0.3, depth: 10 }, this.scene);
        this.bombBayLeft.position = new Vector3(-1.2, -1.2, -3); // Further out and lower for cylindrical fuselage
        this.bombBayLeft.parent = this.bomberGroup;
        this.bombBayLeft.material = bayMaterial;
        // Set pivot point for rotation (left edge of door)
        this.bombBayLeft.rotation.z = 0; // Will rotate around Z axis for outward swing

        // Right door - positioned on the right side of the cylindrical fuselage
        this.bombBayRight = MeshBuilder.CreateBox('bombBayRight', { width: 2.0, height: 0.3, depth: 10 }, this.scene);
        this.bombBayRight.position = new Vector3(1.2, -1.2, -3); // Further out and lower for cylindrical fuselage
        this.bombBayRight.parent = this.bomberGroup;
        this.bombBayRight.material = bayMaterial;
        // Set pivot point for rotation (right edge of door)
        this.bombBayRight.rotation.z = 0; // Will rotate around Z axis for outward swing

        // Create bomb bay interior lighting
        this.createBombBayLighting();
        
        // Create bomb bay particle effects
        this.createBombBayParticles();
        
        // Create glow material for when bay is open
        this.createBombBayGlowMaterial();
    }

    private createBombBayLighting(): void {
        // Create multiple lights inside the bomb bay for dramatic effect
        const lightPositions = [
            new Vector3(0, -2, -1),
            new Vector3(0, -2, -5),
            new Vector3(0, -2, -9)
        ];

        lightPositions.forEach((pos, index) => {
            const light = new PointLight(`bombBayLight${index}`, pos, this.scene);
            light.diffuse = new Color3(1, 0.8, 0.6); // Warm orange light
            light.specular = new Color3(1, 0.8, 0.6);
            light.intensity = 0; // Start off
            light.range = 15;
            light.parent = this.bomberGroup;
            this.bombBayLights.push(light);
        });
    }

    private createBombBayParticles(): void {
        // Create procedural particle texture
        const particleTexture = new DynamicTexture('bombBayParticleTexture', {width: 32, height: 32}, this.scene);
        const particleContext = particleTexture.getContext();
        
        // Create bright particle effect
        const particleGradient = particleContext.createRadialGradient(16, 16, 0, 16, 16, 16);
        particleGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        particleGradient.addColorStop(0.5, 'rgba(255, 200, 100, 0.8)');
        particleGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
        
        particleContext.fillStyle = particleGradient;
        particleContext.fillRect(0, 0, 32, 32);
        particleTexture.update();

        // Create particle system for bomb bay effects
        const bayParticles = new ParticleSystem('bombBayParticles', 100, this.scene);
        bayParticles.particleTexture = particleTexture;
        bayParticles.emitter = this.bomberGroup.position.add(new Vector3(0, -2, -3));
        bayParticles.minEmitBox = new Vector3(-1, 0, -2);
        bayParticles.maxEmitBox = new Vector3(1, 0, 2);
        
        bayParticles.color1 = new Color4(1, 0.9, 0.6, 1.0);
        bayParticles.color2 = new Color4(1, 0.7, 0.3, 0.8);
        bayParticles.colorDead = new Color4(1, 0.5, 0.1, 0.0);
        
        bayParticles.minSize = 0.2;
        bayParticles.maxSize = 0.8;
        bayParticles.minLifeTime = 0.5;
        bayParticles.maxLifeTime = 1.0;
        bayParticles.emitRate = 0; // Start stopped
        bayParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        bayParticles.gravity = new Vector3(0, -1, 0);
        bayParticles.direction1 = new Vector3(-0.5, 0.5, -0.5);
        bayParticles.direction2 = new Vector3(0.5, 1, 0.5);
        bayParticles.minEmitPower = 1;
        bayParticles.maxEmitPower = 3;
        bayParticles.updateSpeed = 0.01;
        
        this.bombBayParticles.push(bayParticles);
    }

    private createBombBayGlowMaterial(): void {
        this.bombBayGlowMaterial = new StandardMaterial('bombBayGlowMaterial', this.scene);
        this.bombBayGlowMaterial.diffuseColor = new Color3(0.15, 0.15, 0.18);
        this.bombBayGlowMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
        this.bombBayGlowMaterial.emissiveColor = new Color3(0.1, 0.08, 0.12); // Subtle glow
        this.bombBayGlowMaterial.alpha = 0.9;
    }

    private createEngines(): void {
        // Engine nacelles embedded in wings
        const positions = [
            new Vector3(-11, -0.8, -5),
            new Vector3(-20, -0.8, -9),
            new Vector3(11, -0.8, -5),
            new Vector3(20, -0.8, -9)
        ];

        positions.forEach((pos, index) => {
            const engine = MeshBuilder.CreateCylinder(`engine${index}`, {
                height: 4,
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
                height: 2,
                diameter: 1.5
            }, this.scene);

            exhaust.position = pos.add(new Vector3(0, 0, -2));
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
        // AND if Ctrl is NOT pressed (Ctrl + arrows is for camera distance)
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
        // AND when Ctrl+Up/Down is NOT pressed (Ctrl+Up/Down is for camera distance)
        if (inputManager.isKeyPressed('ArrowUp') && !inputManager.isShiftUpPressed() && !inputManager.isCtrlUpPressed()) {
            this.altitude -= this.climbRate * deltaTime; // Up arrow decreases altitude
            isDiving = true;
            // If not already turning, add slight banking for dive
            if (!isTurning) {
                this.targetBankAngle = -this.maxClimbBankAngle; // Slight left bank during dive
            }
        }
        if (inputManager.isKeyPressed('ArrowDown') && !inputManager.isShiftDownPressed() && !inputManager.isCtrlDownPressed()) {
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

        // Update bomb bay state and effects
        this.updateBombBay(deltaTime);

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
        if (this.bombBayState === 'closed') {
            this.bombBayState = 'opening';
            this.bombBayOpenStartTime = performance.now() / 1000;
            this.bombBayOpenProgress = 0;
            
            // Start visual effects
            this.startBombBayEffects();
        }
    }

    public closeBombBay(): void {
        if (this.bombBayState === 'open') {
            this.bombBayState = 'closing';
            this.bombBayOpenStartTime = performance.now() / 1000; // Set the start time for closing animation
            this.bombBayOpenProgress = 1; // Start from fully open position
            
            // Don't stop effects immediately - let them fade out during closing animation
        }
    }

    public forceCloseBombBay(): void {
        // Immediately close bomb bay and stop all effects
        this.bombBayState = 'closed';
        this.bombBayOpenProgress = 0;
        this.missileLaunchPending = false;
        this.stopBombBayEffects();
    }

    public updateBombBay(deltaTime: number): void {
        const currentTime = performance.now() / 1000;
        
        if (this.bombBayState === 'opening') {
            const elapsed = currentTime - this.bombBayOpenStartTime;
            this.bombBayOpenProgress = Math.min(elapsed / this.bombBayOpenTime, 1);
            
            // Update door rotations based on progress
            const maxRotation = Math.PI / 3; // 60 degrees
            this.bombBayLeft.rotation.z = this.bombBayOpenProgress * maxRotation;
            this.bombBayRight.rotation.z = -this.bombBayOpenProgress * maxRotation;
            
            // Update visual effects intensity
            this.updateBombBayEffects(this.bombBayOpenProgress);
            
            if (this.bombBayOpenProgress >= 1) {
                this.bombBayState = 'open';
                
                // If missile launch was pending, execute it now
                if (this.missileLaunchPending) {
                    this.missileLaunchPending = false;
                    this.executeMissileLaunch();
                }
            }
        } else if (this.bombBayState === 'closing') {
            const elapsed = currentTime - this.bombBayOpenStartTime;
            this.bombBayOpenProgress = Math.max(1 - (elapsed / this.bombBayOpenTime), 0);
            
            // Update door rotations based on progress
            const maxRotation = Math.PI / 3; // 60 degrees
            this.bombBayLeft.rotation.z = this.bombBayOpenProgress * maxRotation;
            this.bombBayRight.rotation.z = -this.bombBayOpenProgress * maxRotation;
            
            // Update visual effects intensity - fade out during closing
            this.updateBombBayEffects(this.bombBayOpenProgress);
            
            if (this.bombBayOpenProgress <= 0) {
                this.bombBayState = 'closed';
                // Now stop all effects since doors are fully closed
                this.stopBombBayEffects();
            }
        }
    }

    private startBombBayEffects(): void {
        // Start particle effects
        this.bombBayParticles.forEach(particles => {
            particles.start();
        });
        
        // Start lights
        this.bombBayLights.forEach(light => {
            light.intensity = 2;
        });
        
        // Apply glow material to doors
        if (this.bombBayGlowMaterial) {
            this.bombBayLeft.material = this.bombBayGlowMaterial;
            this.bombBayRight.material = this.bombBayGlowMaterial;
        }
    }

    private stopBombBayEffects(): void {
        // Stop particle effects
        this.bombBayParticles.forEach(particles => {
            particles.stop();
        });
        
        // Stop lights
        this.bombBayLights.forEach(light => {
            light.intensity = 0;
        });
        
        // Restore original material - create new instance to avoid reference issues
        const originalMaterial = new StandardMaterial('bayMaterial', this.scene);
        originalMaterial.diffuseColor = new Color3(0.1, 0.1, 0.12);
        originalMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
        originalMaterial.emissiveColor = new Color3(0.02, 0.02, 0.03);
        
        // Apply to both doors
        if (this.bombBayLeft) {
            this.bombBayLeft.material = originalMaterial;
        }
        if (this.bombBayRight) {
            this.bombBayRight.material = originalMaterial;
        }
        
        // Reset glow material emissive to prevent lingering effects
        if (this.bombBayGlowMaterial) {
            this.bombBayGlowMaterial.emissiveColor = new Color3(0.1, 0.08, 0.12);
        }
    }

    private updateBombBayEffects(intensity: number): void {
        // Update light intensity
        this.bombBayLights.forEach(light => {
            light.intensity = intensity * 2;
        });
        
        // Update particle emission rate
        this.bombBayParticles.forEach(particles => {
            particles.emitRate = intensity * 100;
        });
        
        // Update glow material intensity
        if (this.bombBayGlowMaterial) {
            this.bombBayGlowMaterial.emissiveColor = new Color3(
                0.1 * intensity,
                0.08 * intensity,
                0.12 * intensity
            );
        }
    }

    public isBombBayOpen(): boolean {
        return this.bombBayState === 'open';
    }

    public isBombBayOpening(): boolean {
        return this.bombBayState === 'opening';
    }

    public isBombBayClosing(): boolean {
        return this.bombBayState === 'closing';
    }

    public isBombBayActive(): boolean {
        return this.bombBayState === 'opening' || this.bombBayState === 'closing';
    }

    public isWeaponSystemActive(): boolean {
        return this.isBombBayActive() || this.missileLaunchPending;
    }

    public getBombBayOpenProgress(): number {
        return this.bombBayOpenProgress;
    }

    // Missile system methods
    public canLaunchMissile(): boolean {
        const currentTime = performance.now() / 1000;
        const cooldownReady = (currentTime - this.lastMissileLaunchTime) >= this.missileCooldownTime;
        // Can launch if bomb bay is closed (not being used for bombing) or if missile launch is already pending
        const bombBayAvailable = this.bombBayState === 'closed' || this.missileLaunchPending;
        // Also check if bombing run is not active
        const noBombingRun = !this.isBombingRunActiveCallback || !this.isBombingRunActiveCallback();
        return cooldownReady && bombBayAvailable && noBombingRun;
    }

    public setBombingRunActiveCallback(callback: () => boolean): void {
        this.isBombingRunActiveCallback = callback;
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

        // Check if bomb bay is ready for launch
        if (this.bombBayState === 'closed') {
            // Open bomb bay first, then launch missile when fully open
            this.missileLaunchPending = true;
            this.openBombBay();
            return true; // Return true to indicate launch sequence started
        } else if (this.bombBayState === 'opening') {
            // Still opening, wait for it to complete
            this.missileLaunchPending = true;
            return true; // Return true to indicate launch sequence in progress
        } else if (this.bombBayState === 'closing') {
            // Doors are closing, can't launch
            return false;
        }

        // Bomb bay is open, proceed with launch
        this.executeMissileLaunch();
        return true;
    }

    private executeMissileLaunch(): void {
        // Find the closest defense building
        const targetBuilding = this.findClosestDefenseBuilding();
        if (!targetBuilding) return; // No valid target in range

        const currentTime = performance.now() / 1000;
        this.lastMissileLaunchTime = currentTime;

        // Launch position from bomb bay
        const launcherPosition = this.bomberGroup.position.add(new Vector3(0, -2, -1));

        // Create and launch missile targeting the defense building
        const missile = new TomahawkMissile(
            this.scene,
            launcherPosition,
            targetBuilding,
            this.rotation.clone()
        );

        // Set up target destruction callback
        missile.setOnTargetDestroyedCallback((building: Building) => {
            if (this.onTargetDestroyedCallback) {
                this.onTargetDestroyedCallback(building);
            }
        });

        this.missiles.push(missile);
        missile.launch();

        // Immediately start closing bomb bay after launch
        this.closeBombBay();
        
        // Ensure missile launch pending is reset
        this.missileLaunchPending = false;
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

    // Health system methods
    public getHealth(): number {
        return this.health;
    }

    public getMaxHealth(): number {
        return this.maxHealth;
    }

    public isBomberDestroyed(): boolean {
        return this.isDestroyed;
    }

    public takeDamage(damageAmount: number): void {
        if (this.isDestroyed) return;

        const currentTime = performance.now() / 1000;
        const timeSinceLastDamage = currentTime - this.lastDamageTime;
        if (timeSinceLastDamage < 0.1) return; // Ignore damage if taken too frequently

        this.health -= damageAmount;
        this.lastDamageTime = currentTime;

        // Trigger visual damage effects
        this.triggerDamageEffects();

        if (this.health <= 0) {
            this.health = 0;
            this.isDestroyed = true;
            this.triggerDestructionEffects();
            this.onDestroyedCallback?.();
        }
    }

    private triggerDestructionEffects(): void {
        // Create massive explosion effect
        const explosionParticles = new ParticleSystem('bomberDestruction', 500, this.scene);
        explosionParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        explosionParticles.emitter = this.bomberGroup.position;
        explosionParticles.minEmitBox = new Vector3(-10, -5, -15);
        explosionParticles.maxEmitBox = new Vector3(10, 5, 15);
        
        explosionParticles.color1 = new Color4(1, 1, 0, 1);
        explosionParticles.color2 = new Color4(1, 0.5, 0, 1);
        explosionParticles.colorDead = new Color4(0.5, 0, 0, 0);
        
        explosionParticles.emitRate = 500;
        explosionParticles.minLifeTime = 1;
        explosionParticles.maxLifeTime = 3;
        explosionParticles.minSize = 3;
        explosionParticles.maxSize = 8;
        explosionParticles.minEmitPower = 50;
        explosionParticles.maxEmitPower = 100;
        explosionParticles.updateSpeed = 0.01;
        
        explosionParticles.direction1 = new Vector3(-2, -1, -2);
        explosionParticles.direction2 = new Vector3(2, 2, 2);
        explosionParticles.gravity = new Vector3(0, -10, 0);
        explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        explosionParticles.start();
        setTimeout(() => explosionParticles.stop(), 3000);

        // Stop all engine particles
        this.particleSystems.forEach(ps => ps.stop());

        // Make bomber fall
        this.speed = 0;
        this.velocity = new Vector3(0, -20, 0);
    }

    private setupDamageEffects(): void {
        // Clear existing damage effects
        this.damageEffects.forEach(ps => ps.dispose());
        this.damageEffects = [];
        
        if (this.damageLight) {
            this.damageLight.dispose();
            this.damageLight = null;
        }

        // Create damage light
        this.damageLight = new PointLight('bomberDamageLight', new Vector3(0, 0, 0), this.scene);
        this.damageLight.diffuse = new Color3(1, 0.2, 0.1);
        this.damageLight.specular = new Color3(1, 0.2, 0.1);
        this.damageLight.intensity = 0;
        this.damageLight.range = 50;
        this.damageLight.parent = this.bomberGroup;

        // Create smoke particles for damage
        const smokeParticles = new ParticleSystem('bomberSmoke', 100, this.scene);
        smokeParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        smokeParticles.emitter = this.bomberGroup.position;
        smokeParticles.minEmitBox = new Vector3(-5, -2, -10);
        smokeParticles.maxEmitBox = new Vector3(5, 2, 10);
        
        smokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.8);
        smokeParticles.color2 = new Color4(0.1, 0.1, 0.1, 0.6);
        smokeParticles.colorDead = new Color4(0.1, 0.1, 0.1, 0);
        
        smokeParticles.emitRate = 0; // Start stopped
        smokeParticles.minLifeTime = 2;
        smokeParticles.maxLifeTime = 4;
        smokeParticles.minSize = 2;
        smokeParticles.maxSize = 5;
        smokeParticles.minEmitPower = 5;
        smokeParticles.maxEmitPower = 10;
        smokeParticles.updateSpeed = 0.01;
        
        smokeParticles.direction1 = new Vector3(-0.5, 1, -0.5);
        smokeParticles.direction2 = new Vector3(0.5, 1.5, 0.5);
        smokeParticles.gravity = new Vector3(0, 2, 0);
        smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

        // Create fire particles for critical damage
        const fireParticles = new ParticleSystem('bomberFire', 150, this.scene);
        fireParticles.particleTexture = new Texture("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", this.scene);
        
        fireParticles.emitter = this.bomberGroup.position;
        fireParticles.minEmitBox = new Vector3(-3, -1, -8);
        fireParticles.maxEmitBox = new Vector3(3, 1, 8);
        
        fireParticles.color1 = new Color4(1, 0.5, 0, 1);
        fireParticles.color2 = new Color4(1, 0.2, 0, 0.8);
        fireParticles.colorDead = new Color4(0.5, 0.1, 0, 0);
        
        fireParticles.emitRate = 0; // Start stopped
        fireParticles.minLifeTime = 0.5;
        fireParticles.maxLifeTime = 1.5;
        fireParticles.minSize = 1;
        fireParticles.maxSize = 3;
        fireParticles.minEmitPower = 10;
        fireParticles.maxEmitPower = 20;
        fireParticles.updateSpeed = 0.01;
        
        fireParticles.direction1 = new Vector3(-0.3, 0.5, -0.3);
        fireParticles.direction2 = new Vector3(0.3, 1, 0.3);
        fireParticles.gravity = new Vector3(0, 5, 0);
        fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        this.damageEffects.push(smokeParticles, fireParticles);
    }

    public triggerDamageEffects(): void {
        if (this.isDestroyed || !this.damageEffects.length) return;

        const currentTime = performance.now() / 1000;
        const timeSinceLastDamage = currentTime - this.lastDamageTime;
        
        if (timeSinceLastDamage < 0.1) return; // Prevent spam

        // Start smoke effects
        const smokeParticles = this.damageEffects[0];
        if (smokeParticles && !smokeParticles.isStarted()) {
            smokeParticles.start();
            setTimeout(() => smokeParticles.stop(), this.damageEffectDuration * 1000);
        }

        // Start fire effects if health is low
        if (this.health < this.maxHealth * 0.3) {
            const fireParticles = this.damageEffects[1];
            if (fireParticles && !fireParticles.isStarted()) {
                fireParticles.start();
                setTimeout(() => fireParticles.stop(), this.damageEffectDuration * 1000);
            }
        }

        // Flash damage light
        if (this.damageLight) {
            this.damageLight.intensity = 2;
            setTimeout(() => {
                if (this.damageLight) {
                    this.damageLight.intensity = 0;
                }
            }, 200);
        }
    }

    public getHealthPercentage(): number {
        return (this.health / this.maxHealth) * 100;
    }

    public isCriticalHealth(): boolean {
        return this.health < this.maxHealth * 0.3;
    }

    public setOnDestroyedCallback(callback: () => void): void {
        this.onDestroyedCallback = callback;
    }

    public setOnTargetDestroyedCallback(callback: (building: Building) => void): void {
        this.onTargetDestroyedCallback = callback;
    }

    // Countermeasure flare system
    public canLaunchFlares(): boolean {
        const currentTime = performance.now() / 1000;
        return (currentTime - this.lastFlareTime) >= this.flareCooldown;
    }

    public getFlareCooldownStatus(): number {
        const currentTime = performance.now() / 1000;
        const timeSinceLastFlare = currentTime - this.lastFlareTime;
        return Math.min(timeSinceLastFlare / this.flareCooldown, 1);
    }

    public launchFlares(): boolean {
        if (!this.canLaunchFlares()) return false;

        const currentTime = performance.now() / 1000;
        this.lastFlareTime = currentTime;

        // Create multiple flare positions around the bomber
        const flarePositions = [
            this.position.add(new Vector3(10, -5, 10)),
            this.position.add(new Vector3(-10, -5, -10)),
            this.position.add(new Vector3(10, -5, -10)),
            this.position.add(new Vector3(-10, -5, 10)),
            this.position.add(new Vector3(0, -8, 15)),
            this.position.add(new Vector3(0, -8, -15))
        ];

        // Create visual effects for each flare
        flarePositions.forEach((flarePos, index) => {
            // Create flare mesh
            const flareMesh = MeshBuilder.CreateSphere(`flare${index}`, { diameter: 0.5 }, this.scene);
            flareMesh.position = flarePos.clone();
            
            const flareMaterial = new StandardMaterial(`flareMaterial${index}`, this.scene);
            flareMaterial.diffuseColor = new Color3(1, 0.8, 0.2); // Bright orange-yellow
            flareMaterial.emissiveColor = new Color3(1, 0.6, 0.1); // Glowing effect
            flareMaterial.specularColor = new Color3(1, 1, 1);
            flareMesh.material = flareMaterial;
            
            // Add point light to flare
            const flareLight = new PointLight(`flareLight${index}`, flarePos.clone(), this.scene);
            flareLight.diffuse = new Color3(1, 0.8, 0.2);
            flareLight.specular = new Color3(1, 0.8, 0.2);
            flareLight.intensity = 3;
            flareLight.range = 20;
            
            // Create flare particle system
            const flareParticles = this.createFlareParticleSystem(flarePos.clone(), index);
            
            // Store references for cleanup
            this.flareMeshes.push(flareMesh);
            this.flareParticleSystems.push(flareParticles);
        });

        // Add flares to active list
        this.activeFlares.push(...flarePositions);

        // Remove flares after lifetime
        setTimeout(() => {
            // Remove flare positions
            this.activeFlares.splice(0, flarePositions.length);
            
            // Clean up visual effects
            this.flareMeshes.forEach(mesh => {
                if (mesh) {
                    mesh.dispose();
                }
            });
            this.flareMeshes = [];
            
            this.flareParticleSystems.forEach(particles => {
                if (particles) {
                    particles.dispose();
                }
            });
            this.flareParticleSystems = [];
        }, this.flareLifetime * 1000);

        return true;
    }

    private createFlareParticleSystem(flarePosition: Vector3, index: number): ParticleSystem {
        // Create procedural flare texture
        const flareTexture = new DynamicTexture(`flareTexture${index}`, {width: 32, height: 32}, this.scene);
        const flareContext = flareTexture.getContext();
        
        // Create bright flare effect
        const flareGradient = flareContext.createRadialGradient(16, 16, 0, 16, 16, 16);
        flareGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        flareGradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.9)');
        flareGradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.6)');
        flareGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
        
        flareContext.fillStyle = flareGradient;
        flareContext.fillRect(0, 0, 32, 32);
        flareTexture.update();

        // Create flare particle system
        const flareParticles = new ParticleSystem(`flareParticles${index}`, 100, this.scene);
        flareParticles.particleTexture = flareTexture;
        flareParticles.emitter = flarePosition;
        flareParticles.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
        flareParticles.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
        
        // Bright orange-yellow flare colors
        flareParticles.color1 = new Color4(1, 0.9, 0.3, 1.0);
        flareParticles.color2 = new Color4(1, 0.7, 0.2, 0.8);
        flareParticles.colorDead = new Color4(1, 0.5, 0.1, 0.0);
        
        flareParticles.minSize = 0.5;
        flareParticles.maxSize = 1.5;
        flareParticles.minLifeTime = 0.5;
        flareParticles.maxLifeTime = 1.0;
        flareParticles.emitRate = 100;
        flareParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        flareParticles.gravity = new Vector3(0, -2, 0);
        flareParticles.direction1 = new Vector3(-1, 1, -1);
        flareParticles.direction2 = new Vector3(1, 2, 1);
        flareParticles.minEmitPower = 2;
        flareParticles.maxEmitPower = 5;
        flareParticles.updateSpeed = 0.01;
        
        flareParticles.start();
        
        return flareParticles;
    }

    public getActiveFlares(): Vector3[] {
        return this.activeFlares.map(flare => flare.clone());
    }

    public hasActiveFlares(): boolean {
        return this.activeFlares.length > 0;
    }

    public getFlareDetectionRange(): number {
        return this.flareDetectionRange;
    }

    public dispose(): void {
        // Force close bomb bay and clean up all effects
        this.forceCloseBombBay();
        
        // Clean up bomb bay resources
        this.bombBayLights.forEach(light => {
            if (light) {
                light.dispose();
            }
        });
        this.bombBayLights = [];
        
        this.bombBayParticles.forEach(particles => {
            if (particles) {
                particles.dispose();
            }
        });
        this.bombBayParticles = [];
        
        if (this.bombBayGlowMaterial) {
            this.bombBayGlowMaterial.dispose();
            this.bombBayGlowMaterial = null;
        }
        
        // Clean up flare resources
        this.flareMeshes.forEach(mesh => {
            if (mesh) {
                mesh.dispose();
            }
        });
        this.flareMeshes = [];
        
        this.flareParticleSystems.forEach(particles => {
            if (particles) {
                particles.dispose();
            }
        });
        this.flareParticleSystems = [];
        
        // Clear active flares
        this.activeFlares = [];
        
        // Clean up damage effects
        this.damageEffects.forEach(ps => ps.dispose());
        this.damageEffects = [];
        
        if (this.damageLight) {
            this.damageLight.dispose();
            this.damageLight = null;
        }
        
        // Clean up engine particles
        this.particleSystems.forEach(ps => ps.dispose());
        this.particleSystems = [];
        
        // Clean up bomber mesh
        if (this.bomberGroup) {
            this.bomberGroup.dispose();
        }
    }
} 
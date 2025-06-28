import { Scene, Vector3, HemisphericLight, DirectionalLight, Color3, FreeCamera, Mesh, MeshBuilder, StandardMaterial, Texture, DynamicTexture } from '@babylonjs/core';
import { Bomber } from './Bomber';
import { TerrainManager } from './TerrainManager';
import { InputManager } from './InputManager';
import { CameraController, CameraLockMode } from './CameraController';
import { Bomb } from './Bomb';
import { TomahawkMissile } from './TomahawkMissile';
import { IskanderMissile } from './IskanderMissile';
import { UIManager } from '../ui/UIManager';
import { RadarManager } from '../ui/RadarManager';
import { WorkerManager } from './WorkerManager';
import { Building } from './Building';

export class Game {
    private scene: Scene;
    private canvas: HTMLCanvasElement;
    private bomber!: Bomber;
    private terrainManager!: TerrainManager;
    private inputManager!: InputManager;
    private cameraController!: CameraController;
    private camera!: FreeCamera;
    private uiManager!: UIManager;
    private radarManager!: RadarManager;
    private groundCrosshair!: Mesh;
    private workerManager!: WorkerManager;

    // Bombing properties
    private bombs: Bomb[] = [];
    private isBombingRun: boolean = false;
    private bombingRunCooldown: number = 15; // 15 seconds
    private lastBombingRunTime: number = -Infinity; // Start with cooldown finished
    private bombsToDrop: number = 0;
    private lastBombDropTime: number = 0;

    // Iskander missile system
    private iskanderMissiles: IskanderMissile[] = [];
    private lastIskanderLaunchTime: number = -Infinity;
    private iskanderLaunchInterval: number = 45; // Increased from 25 to 45 seconds
    private iskanderRandomInterval: number = 30; // Increased from 20 to 30 seconds

    // Camera toggle properties
    private lastCameraToggleTime: number = 0;
    private cameraToggleCooldown: number = 0.3; // 300ms cooldown to prevent rapid toggling
    
    // Scoring system
    private destroyedBuildings: number = 0;
    private destroyedTargets: number = 0;

    // Game state
    private gameOver: boolean = false;
    private gameOverTime: number = 0;
    private gameOverDelay: number = 5; // 5 seconds before restart

    // Performance optimization: frame rate control and caching
    private lastFrameTime: number = 0;
    private targetFrameRate: number = 60;
    private frameInterval: number = 1000 / 60; // 16.67ms for 60 FPS
    private lastTerrainUpdateTime: number = 0;
    private terrainUpdateInterval: number = 100; // Update terrain every 100ms
    private lastDefenseUpdateTime: number = 0;
    private defenseUpdateInterval: number = 50; // Update defense every 50ms
    private lastUIUpdateTime: number = 0;
    private uiUpdateInterval: number = 50; // Update UI every 50ms
    private lastRadarUpdateTime: number = 0;
    private radarUpdateInterval: number = 100; // Update radar every 100ms
    private lastCollisionCheckTime: number = 0;
    private collisionCheckInterval: number = 16; // Check collisions every 16ms (60fps)
    private cachedBomberPosition: Vector3 = new Vector3();
    private positionCacheValid: boolean = false;
    private positionCacheThreshold: number = 5; // Recalculate if moved more than 5 units

    constructor(scene: Scene, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.canvas = canvas;
    }

    public async initialize(): Promise<void> {
        this.setupLighting();
        this.setupCamera();
        
        // Initialize worker manager first
        this.workerManager = new WorkerManager();
        
        this.bomber = new Bomber(this.scene);
        this.terrainManager = new TerrainManager(this.scene, this.workerManager);
        this.bomber.setTerrainManager(this.terrainManager);
        this.terrainManager.setBomber(this.bomber);
        this.inputManager = new InputManager(this.scene, this.canvas);
        this.cameraController = new CameraController(this.camera, this.bomber);
        this.uiManager = new UIManager(this, this.inputManager);
        this.radarManager = new RadarManager();
        this.createGroundCrosshair();

        // Set up bomber destruction callback
        this.bomber.setOnDestroyedCallback(() => {
            this.handleGameOver();
        });

        // Set up target destruction callback
        this.bomber.setOnTargetDestroyedCallback((building: Building) => {
            if (building.isTarget()) {
                this.destroyedTargets++;
            }
        });

        await this.terrainManager.generateInitialTerrain(this.bomber.getPosition());
        
        this.startGameLoop();
    }

    private setupLighting(): void {
        const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene);
        hemisphericLight.intensity = 0.3;

        const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), this.scene);
        directionalLight.intensity = 0.8;
        directionalLight.diffuse = new Color3(1, 0.9, 0.7);
    }

    private setupCamera(): void {
        this.camera = new FreeCamera('camera', new Vector3(0, 100, -200), this.scene);
        this.camera.setTarget(Vector3.Zero());
        this.camera.attachControl(this.canvas, true);
    }

    private createGroundCrosshair(): void {
        this.groundCrosshair = MeshBuilder.CreatePlane('groundCrosshair', {size: 10}, this.scene);
        this.groundCrosshair.rotation.x = Math.PI / 2;
        this.groundCrosshair.isPickable = false;

        const crosshairMaterial = new StandardMaterial('crosshairMaterial', this.scene);
        
        // Use DynamicTexture to draw a crosshair
        const textureSize = 64;
        const dynamicTexture = new DynamicTexture("dynamic crosshair", textureSize, this.scene, false);
        const ctx = dynamicTexture.getContext();

        // Clear with transparent background
        ctx.clearRect(0, 0, textureSize, textureSize);

        // Draw the 'X'
        ctx.strokeStyle = "rgba(200, 200, 200, 0.3)"; // Dimmer, more translucent white
        ctx.lineWidth = 1; // Thinner line
        
        // Line 1 (\\)
        ctx.beginPath();
        ctx.moveTo(textureSize * 0.3, textureSize * 0.3);
        ctx.lineTo(textureSize * 0.7, textureSize * 0.7);
        ctx.stroke();
        
        // Line 2 (/)
        ctx.beginPath();
        ctx.moveTo(textureSize * 0.7, textureSize * 0.3);
        ctx.lineTo(textureSize * 0.3, textureSize * 0.7);
        ctx.stroke();
        
        dynamicTexture.update();

        crosshairMaterial.diffuseTexture = dynamicTexture;
        crosshairMaterial.diffuseTexture.hasAlpha = true;
        crosshairMaterial.useAlphaFromDiffuseTexture = true;
        crosshairMaterial.emissiveColor = Color3.White();
        crosshairMaterial.disableLighting = true;
        crosshairMaterial.backFaceCulling = false; // Render from both sides

        this.groundCrosshair.material = crosshairMaterial;
        this.groundCrosshair.setEnabled(false);
    }

    public startGameLoop(): void {
        let lastFrameTime = performance.now();
        
        this.scene.registerBeforeRender(() => {
            try {
                const currentTime = performance.now();
                
                // Check for game over condition FIRST, before any frame rate limiting
                if (this.gameOver) {
                    const timeSinceGameOver = (currentTime / 1000) - this.gameOverTime;
                    if (timeSinceGameOver >= this.gameOverDelay) {
                        // Restart the game
                        location.reload();
                        return; // Exit early to prevent further processing
                    }
                }
                
                // Performance optimization: frame rate limiting
                if (currentTime - lastFrameTime < this.frameInterval) {
                    return;
                }
                
                const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
                
                const safeDeltaTime = Math.min(deltaTime, 0.1);
                const safeCurrentTime = currentTime / 1000;

                // Always update critical systems
                this.handleBombing(safeCurrentTime);
                this.handleMissileLaunch();
                this.handleIskanderLaunch(safeCurrentTime);
                this.handleCountermeasures();
                this.handleCameraToggle(safeCurrentTime);
                this.bomber.update(safeDeltaTime, this.inputManager);
                this.cameraController.update(safeDeltaTime, this.inputManager);
                this.updateBombs(safeDeltaTime);
                this.updateIskanderMissiles(safeDeltaTime);
                this.updateGroundCrosshair();

                // Check for defense missile collisions (high frequency for responsive damage)
                if (currentTime - this.lastCollisionCheckTime > this.collisionCheckInterval) {
                    this.checkDefenseMissileCollisions();
                    this.checkIskanderMissileCollisions();
                    this.lastCollisionCheckTime = currentTime;
                }

                // Update terrain less frequently
                if (currentTime - this.lastTerrainUpdateTime > this.terrainUpdateInterval) {
                    this.terrainManager.update(this.bomber.getPosition());
                    this.lastTerrainUpdateTime = currentTime;
                }

                // Update defense launchers less frequently
                if (currentTime - this.lastDefenseUpdateTime > this.defenseUpdateInterval) {
                    this.terrainManager.updateDefenseLaunchers(
                        this.bomber.getPosition(), 
                        safeCurrentTime, 
                        safeDeltaTime
                    );
                    this.lastDefenseUpdateTime = currentTime;
                }

                // Update UI less frequently
                if (currentTime - this.lastUIUpdateTime > this.uiUpdateInterval) {
                    this.uiManager.update();
                    this.lastUIUpdateTime = currentTime;
                }

                // Update radar less frequently
                if (currentTime - this.lastRadarUpdateTime > this.radarUpdateInterval) {
                    this.radarManager.update(this.bomber, this.terrainManager, this.destroyedTargets, this.iskanderMissiles);
                    this.lastRadarUpdateTime = currentTime;
                }

                this.inputManager.endFrame();
                
                lastFrameTime = currentTime;
                
            } catch (error) {
                // Silent error handling - no console logging
            }
        });
    }

    private handleBombing(currentTime: number): void {
        if (this.inputManager.isBombKeyPressed() && this.isBombingAvailable()) {
            this.startBombingRun();
        }

        // Only drop bombs if we're in a bombing run AND the bomb bay is fully open
        if (this.isBombingRun && this.bombsToDrop > 0 && this.bomber.isBombBayOpen() && (currentTime - this.lastBombDropTime) >= 1) {
            this.dropBomb();
            this.bombsToDrop--;
            this.lastBombDropTime = currentTime;
        }

        // End bombing run when all bombs are dropped
        if (this.isBombingRun && this.bombsToDrop === 0) {
            this.isBombingRun = false;
            this.bomber.closeBombBay();
            this.lastBombingRunTime = currentTime;
        }
    }

    private handleMissileLaunch(): void {
        if (this.inputManager.isMissileKeyPressed() && this.bomber.canLaunchMissile() && this.bomber.hasValidTarget()) {
            this.bomber.launchMissile();
        }
    }

    private handleIskanderLaunch(currentTime: number): void {
        // Check if it's time to launch an Iskander missile
        const timeSinceLastLaunch = currentTime - this.lastIskanderLaunchTime;
        const totalInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
        
        if (timeSinceLastLaunch >= totalInterval) {
            this.launchIskanderMissile();
            this.lastIskanderLaunchTime = currentTime;
        }
    }

    private launchIskanderMissile(): void {
        // Find the defense launcher farthest from the bomber
        const bomberPosition = this.bomber.getPosition();
        const buildings = this.terrainManager.getBuildingsInRadius(bomberPosition, 1000);
        
        let farthestLauncher = null;
        let maxDistance = 0;
        
        for (const building of buildings) {
            if (building.isDefenseLauncher() && !building.getIsDestroyed()) {
                const distance = Vector3.Distance(bomberPosition, building.getPosition());
                if (distance > maxDistance) {
                    maxDistance = distance;
                    farthestLauncher = building;
                }
            }
        }
        
        if (farthestLauncher) {
            const launchPosition = farthestLauncher.getPosition().clone();
            launchPosition.y += 5; // Launch from above the launcher
            
            const missile = new IskanderMissile(this.scene, launchPosition, this.bomber, this.workerManager);
            
            // Set up lock-on notification callback
            missile.setOnLockEstablishedCallback(() => {
                this.uiManager.showAlert('MISSILE LOCK DETECTED!', 'iskander-lock', 8000);
            });
            
            missile.launch();
            this.iskanderMissiles.push(missile);
        }
    }

    private handleCountermeasures(): void {
        if (this.inputManager.isCountermeasureKeyPressed() && this.bomber.canLaunchFlares()) {
            this.bomber.launchFlares();
        }
    }

    private updateIskanderMissiles(deltaTime: number): void {
        // Update all Iskander missiles
        for (let i = this.iskanderMissiles.length - 1; i >= 0; i--) {
            const missile = this.iskanderMissiles[i];
            
            // Update missile physics (now handled by worker)
            missile.update(deltaTime);
            
            // Add active flares to missile for targeting
            const activeFlares = this.bomber.getActiveFlares();
            activeFlares.forEach(flare => {
                missile.addFlareTarget(flare);
            });

            // Remove missiles that have exploded
            if (missile.hasExploded()) {
                setTimeout(() => {
                    missile.dispose();
                    const index = this.iskanderMissiles.indexOf(missile);
                    if (index > -1) {
                        this.iskanderMissiles.splice(index, 1);
                    }
                }, 2000); // Reduced from 10 seconds to 2 seconds for faster cleanup
            }
        }
    }

    private checkIskanderMissileCollisions(): void {
        if (this.gameOver || this.bomber.isBomberDestroyed()) return;

        const bomberPosition = this.bomber.getPosition();
        
        for (const missile of this.iskanderMissiles) {
            if (missile.isLaunched() && !missile.hasExploded()) {
                const missilePosition = missile.getPosition();
                const distance = Vector3.Distance(bomberPosition, missilePosition);
                
                // Check for direct hit or proximity explosion
                if (distance <= 8) { // Direct hit radius
                    this.bomber.takeDamage(50); // Increased from 30% to 50% of bomber health
                    missile.explode();
                } else if (distance <= 20) { // Proximity explosion
                    const damage = Math.max(10, 40 - distance); // Increased from 25 to 40
                    this.bomber.takeDamage(damage);
                    missile.explode();
                }
            }
        }
    }

    private handleCameraToggle(currentTime: number): void {
        if (this.inputManager.isCameraTogglePressed() && 
            (currentTime - this.lastCameraToggleTime) > this.cameraToggleCooldown) {
            this.cameraController.toggleLockMode();
            this.uiManager.updateCameraToggleIcon();
            this.lastCameraToggleTime = currentTime;
        }
    }

    private dropBomb(): void {
        const bombPosition = this.bomber.getBombBayPosition();
        const bomb = new Bomb(this.scene, bombPosition);
        this.bombs.push(bomb);
    }

    public startBombingRun(): void {
        if (this.isBombingAvailable()) {
            this.isBombingRun = true;
            this.bombsToDrop = 9;
            this.lastBombDropTime = performance.now() / 1000;
            this.bomber.openBombBay();
            // Don't drop bomb immediately - wait for doors to open
        }
    }

    public isBombingAvailable(): boolean {
        const currentTime = performance.now() / 1000;
        return !this.isBombingRun && (currentTime - this.lastBombingRunTime) > this.bombingRunCooldown;
    }

    public isBombingRunActive(): boolean {
        return this.isBombingRun;
    }

    public getBombCooldownStatus(): number {
        const currentTime = performance.now() / 1000;
        const timeSinceLastRun = currentTime - this.lastBombingRunTime;
        const cooldownProgress = Math.min(timeSinceLastRun / this.bombingRunCooldown, 1);
        return this.isBombingRun ? 0 : cooldownProgress;
    }

    public getBomber(): Bomber {
        return this.bomber;
    }

    public getCameraController(): CameraController {
        return this.cameraController;
    }

    public getUIManager(): UIManager {
        return this.uiManager;
    }

    public getDestroyedBuildings(): number {
        return this.destroyedBuildings;
    }

    public getDestroyedTargets(): number {
        return this.destroyedTargets;
    }

    public getBomberHealth(): number {
        return this.bomber.getHealthPercentage();
    }

    public hasIskanderMissilesInRange(): boolean {
        const bomberPosition = this.bomber.getPosition();
        const flareDetectionRange = this.bomber.getFlareDetectionRange();
        
        for (const missile of this.iskanderMissiles) {
            if (missile.isLaunched() && !missile.hasExploded()) {
                const missilePosition = missile.getPosition();
                const distance = Vector3.Distance(bomberPosition, missilePosition);
                if (distance <= flareDetectionRange) {
                    return true;
                }
            }
        }
        return false;
    }

    public getScene(): Scene {
        return this.scene;
    }

    public getEngine() {
        return this.scene.getEngine();
    }

    private updateBombs(deltaTime: number): void {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const bomb = this.bombs[i];
            bomb.update(deltaTime);

            const bombPosition = bomb.getPosition();

            if (bombPosition.y <= 0) {
                const explosionPoint = new Vector3(bombPosition.x, 0, bombPosition.z);
                
                const blastRadius = 50;
                const nearbyBuildings = this.terrainManager.getBuildingsInRadius(explosionPoint, blastRadius);
                
                nearbyBuildings.forEach(building => {
                    const distance = Vector3.Distance(explosionPoint, building.getPosition());
                    const damage = Math.max(10, 50 - distance);
                    
                    const wasDestroyed = building.takeDamage(damage, true);
                    if (wasDestroyed) {
                        this.destroyedBuildings++;
                        if (building.isTarget()) {
                            this.destroyedTargets++;
                        }
                    }
                });
                
                bomb.explode(explosionPoint);
                this.bombs.splice(i, 1);
            }
        }
    }

    private updateGroundCrosshair(): void {
        const cameraMode = this.cameraController.getLockMode();
        if (cameraMode === CameraLockMode.GROUND) {
            this.groundCrosshair.setEnabled(true);
            const bomberPosition = this.bomber.getPosition();
            const terrainHeight = this.terrainManager.getHeightAtPosition(bomberPosition.x, bomberPosition.z);
            this.groundCrosshair.position.set(bomberPosition.x, terrainHeight + 0.5, bomberPosition.z);
        } else {
            this.groundCrosshair.setEnabled(false);
        }
    }

    private handleGameOver(): void {
        this.gameOver = true;
        this.gameOverTime = performance.now() / 1000;
        
        // Show game over message
        this.showGameOverMessage();
    }

    private showGameOverMessage(): void {
        const gameOverDiv = document.createElement('div');
        gameOverDiv.id = 'game-over-message';
        gameOverDiv.innerHTML = `
            <div class="game-over-content">
                <h1>MISSION FAILED</h1>
                <p>Your Bomber has been destroyed!</p>
                <p>Buildings Destroyed: ${this.destroyedBuildings}</p>
                <p>Targets Eliminated: ${this.destroyedTargets}</p>
                <p>Restarting in ${this.gameOverDelay} seconds...</p>
            </div>
        `;
        document.body.appendChild(gameOverDiv);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #game-over-message {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                color: white;
                font-family: Arial, sans-serif;
            }
            .game-over-content {
                text-align: center;
                background-color: rgba(255, 0, 0, 0.2);
                padding: 40px;
                border-radius: 10px;
                border: 2px solid #ff0000;
            }
            .game-over-content h1 {
                color: #ff0000;
                font-size: 3em;
                margin-bottom: 20px;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
            }
            .game-over-content p {
                font-size: 1.2em;
                margin: 10px 0;
            }
        `;
        document.head.appendChild(style);
    }

    private checkDefenseMissileCollisions(): void {
        if (this.gameOver || this.bomber.isBomberDestroyed()) return;

        const bomberPosition = this.bomber.getPosition();
        const buildings = this.terrainManager.getBuildingsInRadius(bomberPosition, 500);
        
        for (const building of buildings) {
            if (building.isDefenseLauncher() && !building.getIsDestroyed()) {
                // Get defense missiles from the building
                const defenseMissiles = building.getDefenseMissiles();
                
                for (const missile of defenseMissiles) {
                    if (missile.isLaunched() && !missile.hasExploded()) {
                        const missilePosition = missile.getPosition();
                        const distance = Vector3.Distance(bomberPosition, missilePosition);
                        
                        // Check for direct hit or proximity explosion
                        if (distance <= 8) { // Direct hit radius
                            this.bomber.takeDamage(25); // Direct hit damage
                            missile.explode();
                        } else if (distance <= 20) { // Proximity explosion
                            const damage = Math.max(5, 20 - distance);
                            this.bomber.takeDamage(damage);
                            missile.explode();
                        }
                    }
                }
            }
        }
    }
} 
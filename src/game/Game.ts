import { Scene, Vector3, HemisphericLight, DirectionalLight, Color3, FreeCamera } from '@babylonjs/core';
import { B2Bomber } from './B2Bomber';
import { TerrainManager } from './TerrainManager';
import { InputManager } from './InputManager';
import { CameraController } from './CameraController';
import { Bomb } from './Bomb';
import { TomahawkMissile } from './TomahawkMissile';
import { UIManager } from '../ui/UIManager';
import { RadarManager } from '../ui/RadarManager';

export class Game {
    private scene: Scene;
    private canvas: HTMLCanvasElement;
    private bomber!: B2Bomber;
    private terrainManager!: TerrainManager;
    private inputManager!: InputManager;
    private cameraController!: CameraController;
    private camera!: FreeCamera;
    private uiManager!: UIManager;
    private radarManager!: RadarManager;

    // Bombing properties
    private bombs: Bomb[] = [];
    private isBombingRun: boolean = false;
    private bombingRunCooldown: number = 15; // 15 seconds
    private lastBombingRunTime: number = -Infinity; // Start with cooldown finished
    private bombsToDrop: number = 0;
    private lastBombDropTime: number = 0;

    // Camera toggle properties
    private lastCameraToggleTime: number = 0;
    private cameraToggleCooldown: number = 0.3; // 300ms cooldown to prevent rapid toggling
    
    // Scoring system
    private destroyedBuildings: number = 0;
    private destroyedTargets: number = 0;

    constructor(scene: Scene, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.canvas = canvas;
    }

    public async initialize(): Promise<void> {
        this.setupLighting();
        this.setupCamera();
        
        this.bomber = new B2Bomber(this.scene);
        this.terrainManager = new TerrainManager(this.scene);
        this.inputManager = new InputManager(this.scene, this.canvas);
        this.cameraController = new CameraController(this.camera, this.bomber);
        this.uiManager = new UIManager(this, this.inputManager);
        this.radarManager = new RadarManager();

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

    public startGameLoop(): void {
        let lastFrameTime = performance.now();
        let frameCount = 0;
        
        this.scene.registerBeforeRender(() => {
            try {
                const currentTime = performance.now();
                const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
                
                const frameTime = currentTime - lastFrameTime;
                frameCount++;
                
                if (frameTime > 33 && frameCount % 60 === 0) {
                    console.warn(`Performance warning: Frame time ${frameTime.toFixed(2)}ms`);
                }
                
                const safeDeltaTime = Math.min(deltaTime, 0.1);
                const safeCurrentTime = currentTime / 1000;

                this.handleBombing(safeCurrentTime);
                
                this.handleMissileLaunch();

                this.handleCameraToggle(safeCurrentTime);
                
                this.bomber.update(safeDeltaTime, this.inputManager);
                
                this.cameraController.update(safeDeltaTime, this.inputManager);
                
                this.uiManager.update();
                
                this.radarManager.update(this.bomber, this.terrainManager, this.destroyedBuildings, this.destroyedTargets);
                
                this.terrainManager.update(this.bomber.getPosition());
                
                const maxBuildingHeight = this.terrainManager.getMaxBuildingHeight();
                this.bomber.setMinimumAltitude(maxBuildingHeight);

                this.updateBombs(safeDeltaTime);

                this.inputManager.endFrame();
                
                lastFrameTime = currentTime;
                
            } catch (error) {
                console.error('Error in game loop:', error);
            }
        });
    }

    private handleBombing(currentTime: number): void {
        if (this.inputManager.isBombKeyPressed() && this.isBombingAvailable()) {
            this.startBombingRun();
        }

        if (this.isBombingRun && this.bombsToDrop > 0 && (currentTime - this.lastBombDropTime) >= 1) {
            this.dropBomb();
            this.bombsToDrop--;
            this.lastBombDropTime = currentTime;
        }

        if (this.isBombingRun && this.bombsToDrop === 0) {
            this.isBombingRun = false;
            this.bomber.closeBombBay();
            this.lastBombingRunTime = currentTime;
        }
    }

    private handleMissileLaunch(): void {
        if (this.inputManager.isMissileKeyPressed() && this.bomber.canLaunchMissile()) {
            this.bomber.launchMissile();
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
            this.dropBomb();
        }
    }

    public isBombingAvailable(): boolean {
        const currentTime = performance.now() / 1000;
        return !this.isBombingRun && (currentTime - this.lastBombingRunTime) > this.bombingRunCooldown;
    }

    public getBombCooldownStatus(): number {
        const currentTime = performance.now() / 1000;
        const timeSinceLastRun = currentTime - this.lastBombingRunTime;
        const cooldownProgress = Math.min(timeSinceLastRun / this.bombingRunCooldown, 1);
        return this.isBombingRun ? 0 : cooldownProgress;
    }

    public getBomber(): B2Bomber {
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
                    
                    const wasDestroyed = building.takeDamage(damage);
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
} 
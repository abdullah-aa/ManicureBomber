import { Scene, Vector3, HemisphericLight, DirectionalLight, Color3, FreeCamera, Mesh, MeshBuilder, StandardMaterial, Texture, DynamicTexture } from '@babylonjs/core';
import { B2Bomber } from './B2Bomber';
import { TerrainManager } from './TerrainManager';
import { InputManager } from './InputManager';
import { CameraController, CameraLockMode } from './CameraController';
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
    private groundCrosshair!: Mesh;

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
        this.createGroundCrosshair();

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
                
                this.updateGroundCrosshair();

                this.terrainManager.update(this.bomber.getPosition());
                
                // Update defense launchers
                this.terrainManager.updateDefenseLaunchers(
                    this.bomber.getPosition(), 
                    safeCurrentTime, 
                    safeDeltaTime
                );
                
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
} 
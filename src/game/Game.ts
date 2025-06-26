import { Scene, Vector3, HemisphericLight, DirectionalLight, Color3, FreeCamera } from '@babylonjs/core';
import { B2Bomber } from './B2Bomber';
import { TerrainManager } from './TerrainManager';
import { InputManager } from './InputManager';
import { CameraController } from './CameraController';
import { Bomb } from './Bomb';
import { TomahawkMissile } from './TomahawkMissile';
import { UIManager } from '../ui/UIManager';

export class Game {
    private scene: Scene;
    private canvas: HTMLCanvasElement;
    private bomber!: B2Bomber;
    private terrainManager!: TerrainManager;
    private inputManager!: InputManager;
    private cameraController!: CameraController;
    private camera!: FreeCamera;
    private uiManager!: UIManager;

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

    constructor(scene: Scene, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.canvas = canvas;

        this.setupLighting();
        this.setupCamera();
        this.initializeGame();
        this.startGameLoop();
    }

    private setupLighting(): void {
        // Ambient light
        const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene);
        hemisphericLight.intensity = 0.3;

        // Directional light (sun)
        const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), this.scene);
        directionalLight.intensity = 0.8;
        directionalLight.diffuse = new Color3(1, 0.9, 0.7); // Warm sunlight
    }

    private setupCamera(): void {
        this.camera = new FreeCamera('camera', new Vector3(0, 100, -200), this.scene);
        this.camera.setTarget(Vector3.Zero());
        this.camera.attachControl(this.canvas, true);
    }

    private initializeGame(): void {
        // Create the B2 bomber
        this.bomber = new B2Bomber(this.scene);

        // Create terrain manager
        this.terrainManager = new TerrainManager(this.scene);

        // Setup input handling
        this.inputManager = new InputManager(this.scene, this.canvas);

        // Setup camera controller
        this.cameraController = new CameraController(this.camera, this.bomber);

        // Create UI Manager
        this.uiManager = new UIManager(this, this.inputManager);

        // Generate initial terrain around the bomber
        this.terrainManager.generateInitialTerrain(this.bomber.getPosition());
    }

    private startGameLoop(): void {
        this.scene.registerBeforeRender(() => {
            const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
            const currentTime = performance.now() / 1000;

            // Handle bombing runs
            this.handleBombing(currentTime);
            
            // Handle missile launches
            this.handleMissileLaunch();

            // Handle camera mode toggle
            this.handleCameraToggle(currentTime);
            
            // Update bomber based on input
            this.bomber.update(deltaTime, this.inputManager);
            
            // Update camera to follow bomber
            this.cameraController.update(deltaTime, this.inputManager);
            
            // Update UI
            this.uiManager.update();
            
            // Update terrain based on bomber position
            this.terrainManager.update(this.bomber.getPosition());

            // Update bombs
            this.updateBombs(deltaTime);

            // Reset input deltas
            this.inputManager.endFrame();
        });
    }

    private handleBombing(currentTime: number): void {
        // Start a bombing run on key press
        if (this.inputManager.isBombKeyPressed() && this.isBombingAvailable()) {
            this.startBombingRun();
        }

        // Drop subsequent bombs during a bombing run
        if (this.isBombingRun && this.bombsToDrop > 0 && (currentTime - this.lastBombDropTime) >= 1) {
            this.dropBomb();
            this.bombsToDrop--;
            this.lastBombDropTime = currentTime;
        }

        // End bombing run when all bombs are dropped
        if (this.isBombingRun && this.bombsToDrop === 0) {
            this.isBombingRun = false;
            this.bomber.closeBombBay(); // Close bomb bay
            this.lastBombingRunTime = currentTime; // Start cooldown after last bomb
        }
    }

    private handleMissileLaunch(): void {
        // Launch missile on key press
        if (this.inputManager.isMissileKeyPressed() && this.bomber.canLaunchMissile()) {
            this.bomber.launchMissile();
        }
    }

    private handleCameraToggle(currentTime: number): void {
        // Toggle camera mode on 'V' key press with cooldown
        if (this.inputManager.isCameraTogglePressed() && 
            (currentTime - this.lastCameraToggleTime) > this.cameraToggleCooldown) {
            this.cameraController.toggleLockMode();
            this.uiManager.updateCameraToggleIcon(); // Update UI to reflect camera mode change
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
            this.bombsToDrop = 9; // Drop 1 immediately, 9 to go
            this.lastBombDropTime = performance.now() / 1000;
            this.bomber.openBombBay(); // Open bomb bay
            this.dropBomb(); // Drop the first bomb instantly
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

    private updateBombs(deltaTime: number): void {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const bomb = this.bombs[i];
            bomb.update(deltaTime);

            // Check for collision with ground (same level as buildings)
            const bombPosition = bomb.getPosition();

            // Bombs explode when they reach ground level (Y=0) where buildings are
            if (bombPosition.y <= 0) {
                const explosionPoint = new Vector3(bombPosition.x, 0, bombPosition.z);
                bomb.explode(explosionPoint);
                this.bombs.splice(i, 1);
            }
        }
    }
} 
import { Game } from "../game/Game";
import { InputManager } from "../game/InputManager";
import { CameraLockMode } from "../game/CameraController";

export class UIManager {
    private game: Game;
    private inputManager: InputManager;
    private bombButton!: HTMLElement;
    private bombButtonIcon!: HTMLElement;
    private bombButtonCooldown!: HTMLElement;
    private bombBayStatus!: HTMLElement;
    private missileButton!: HTMLElement;
    private missileButtonIcon!: HTMLElement;
    private missileButtonCooldown!: HTMLElement;
    private countermeasureButton!: HTMLElement;
    private countermeasureButtonIcon!: HTMLElement;
    private countermeasureButtonCooldown!: HTMLElement;
    private cameraToggleButton!: HTMLElement;
    private cameraToggleIcon!: HTMLElement;
    private healthBar!: HTMLElement;
    private healthBarFill!: HTMLElement;
    private healthText!: HTMLElement;
    
    // Performance optimization: cache target status
    private cachedHasValidTarget: boolean = false;
    private lastTargetCheckTime: number = 0;
    private targetCheckInterval: number = 0.2; // Check every 200ms instead of every frame

    // Performance optimization: change detection and batching
    private lastBombCooldown: number = -1;
    private lastMissileCooldown: number = -1;
    private lastCountermeasureCooldown: number = -1;
    private lastHasTarget: boolean = false;
    private lastLockMode: CameraLockMode = CameraLockMode.BOMBER;
    private lastHealth: number = -1;
    private updateBatchTimeout: ReturnType<typeof setTimeout> | null = null;
    private pendingUpdates: Set<string> = new Set();

    // Alert system
    private alertContainer!: HTMLElement;
    private activeAlerts: Map<string, HTMLElement> = new Map();
    private alertTimeout: number = 5000; // 5 seconds

    constructor(game: Game, inputManager: InputManager) {
        this.game = game;
        this.inputManager = inputManager;
        this.createBombButton();
        this.createMissileButton();
        this.createCountermeasureButton();
        this.createCameraToggleButton();
        this.createHealthBar();
        this.createAlertSystem();

        // Listen for button clicks to start a bombing run
        this.bombButton.addEventListener('click', () => {
            if (this.game.isBombingAvailable()) {
                this.inputManager.triggerBombKeyPress();
            }
        });

        // Listen for missile button clicks
        this.missileButton.addEventListener('click', () => {
            if (this.game.getBomber().canLaunchMissile() && this.game.getBomber().hasValidTarget()) {
                this.inputManager.triggerMissileKeyPress();
            }
        });

        // Listen for countermeasure button clicks
        this.countermeasureButton.addEventListener('click', () => {
            if (this.game.getBomber().canLaunchFlares()) {
                this.inputManager.triggerCountermeasureKeyPress();
            }
        });

        // Listen for camera toggle button clicks
        this.cameraToggleButton.addEventListener('click', () => {
            this.game.getCameraController().toggleLockMode();
            this.updateCameraToggleIcon();
        });
    }

    private createBombButton(): void {
        this.bombButton = document.createElement('div');
        this.bombButton.id = 'bomb-button';
        this.bombButton.innerHTML = `
            <div id="bomb-icon"></div>
            <div id="bomb-cooldown"></div>
            <div id="bomb-bay-status"></div>
        `;
        document.body.appendChild(this.bombButton);

        this.bombButtonIcon = document.getElementById('bomb-icon')!;
        this.bombButtonCooldown = document.getElementById('bomb-cooldown')!;
        this.bombBayStatus = document.getElementById('bomb-bay-status')!;

        // Add some basic styling
        this.addStyles();
    }

    private createMissileButton(): void {
        this.missileButton = document.createElement('div');
        this.missileButton.id = 'missile-button';
        this.missileButton.innerHTML = `
            <div id="missile-icon"></div>
            <div id="missile-cooldown"></div>
        `;
        document.body.appendChild(this.missileButton);

        this.missileButtonIcon = document.getElementById('missile-icon')!;
        this.missileButtonCooldown = document.getElementById('missile-cooldown')!;
    }

    private createCountermeasureButton(): void {
        this.countermeasureButton = document.createElement('div');
        this.countermeasureButton.id = 'countermeasure-button';
        this.countermeasureButton.innerHTML = `
            <div id="countermeasure-icon"></div>
            <div id="countermeasure-cooldown"></div>
        `;
        document.body.appendChild(this.countermeasureButton);

        this.countermeasureButtonIcon = document.getElementById('countermeasure-icon')!;
        this.countermeasureButtonCooldown = document.getElementById('countermeasure-cooldown')!;
    }

    private createCameraToggleButton(): void {
        this.cameraToggleButton = document.createElement('div');
        this.cameraToggleButton.id = 'camera-toggle-button';
        this.cameraToggleButton.innerHTML = `
            <div id="camera-toggle-icon"></div>
        `;
        document.body.appendChild(this.cameraToggleButton);

        this.cameraToggleIcon = document.getElementById('camera-toggle-icon')!;
        this.updateCameraToggleIcon();
    }

    private createHealthBar(): void {
        this.healthBar = document.createElement('div');
        this.healthBar.id = 'health-bar';
        this.healthBar.innerHTML = `
            <div id="health-bar-fill"></div>
            <span id="health-text"></span>
        `;
        document.body.appendChild(this.healthBar);

        this.healthBarFill = document.getElementById('health-bar-fill')!;
        this.healthText = document.getElementById('health-text')!;

        // Add some basic styling
        this.addHealthBarStyles();
    }

    private createAlertSystem(): void {
        this.alertContainer = document.createElement('div');
        this.alertContainer.id = 'alert-container';
        document.body.appendChild(this.alertContainer);
        this.addAlertStyles();
    }

    private addAlertStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            #alert-container {
                position: fixed;
                top: 100px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 2000;
                pointer-events: none;
            }
            
            .alert {
                background: linear-gradient(135deg, rgba(255, 0, 0, 0.9), rgba(200, 0, 0, 0.9));
                color: white;
                padding: 12px 20px;
                margin-bottom: 10px;
                border-radius: 8px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                font-family: 'Courier New', monospace;
                font-weight: bold;
                font-size: 14px;
                text-align: center;
                min-width: 300px;
                animation: alertSlideIn 0.3s ease-out;
                backdrop-filter: blur(5px);
            }
            
            .alert.iskander-lock {
                background: linear-gradient(135deg, rgba(255, 100, 0, 0.9), rgba(255, 50, 0, 0.9));
                border-color: rgba(255, 255, 0, 0.5);
                box-shadow: 0 4px 12px rgba(255, 100, 0, 0.3);
            }
            
            @keyframes alertSlideIn {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
            
            .alert.fade-out {
                animation: alertFadeOut 0.5s ease-in forwards;
            }
            
            @keyframes alertFadeOut {
                from {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    public updateCameraToggleIcon(): void {
        const lockMode = this.game.getCameraController().getLockMode();
        if (lockMode === CameraLockMode.BOMBER) {
            // Plane icon for bomber lock
            this.cameraToggleIcon.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%2300ffff" d="M233.5 7.8c-26.2 4.4-51.7 19.2-67.6 39.2-13.4 16.8-21.1 36.8-24.1 62.6-1.3 11.4-1.3 40.8 0 52.2 3.1 26.9 11.3 48.1 25.5 66.1 7.9 10 20.8 22.2 31.2 29.6 16.1 11.5 35.4 19.4 55.5 22.8 11.4 1.9 40.8 1.9 52.2 0 20.1-3.4 39.4-11.3 55.5-22.8 10.4-7.4 23.3-19.6 31.2-29.6 14.2-18 22.4-39.2 25.5-66.1 1.3-11.4 1.3-40.8 0-52.2-3-25.8-10.7-45.8-24.1-62.6-15.9-20-41.4-34.8-67.6-39.2-9.4-1.6-43.8-1.6-53.2 0zM304 80c17.7 0 32 14.3 32 32s-14.3 32-32 32-32-14.3-32-32 14.3-32 32-32z"/></svg>')`;
        } else {
            // Ground/terrain icon for ground lock
            this.cameraToggleIcon.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%2300ff00" d="M456 352h-16l-22.63-22.63c6.65-9.43 10.63-20.84 10.63-33.37 0-30.93-25.07-56-56-56s-56 25.07-56 56c0 12.53 3.98 23.94 10.63 33.37L304 352H56c-13.25 0-24 10.75-24 24s10.75 24 24 24h400c13.25 0 24-10.75 24-24s-10.75-24-24-24zM372 320c-8.84 0-16-7.16-16-16s7.16-16 16-16 16 7.16 16 16-7.16 16-16 16z"/></svg>')`;
        }
    }

    private addStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            #bomb-button {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 80px;
                height: 80px;
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #fff;
            }
            #bomb-icon {
                width: 50px;
                height: 50px;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23ffffff" d="M448 32H64C46.33 32 32 46.33 32 64v384c0 17.67 14.33 32 32 32h384c17.67 0 32-14.33 32-32V64c0-17.67-14.33-32-32-32zm-48 104c0 22.09-17.91 40-40 40s-40-17.91-40-40V96c0-22.09 17.91-40 40-40s40 17.91 40 40v40z"/></svg>');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
            }
            #bomb-cooldown {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 0;
                background-color: rgba(0, 255, 0, 0.4);
                z-index: 1;
                transition: height 0.1s linear;
            }
            #bomb-button.unavailable {
                cursor: not-allowed;
            }
            #bomb-button.unavailable #bomb-icon {
                opacity: 0.5;
            }
            #bomb-bay-status {
                position: absolute;
                top: -25px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 165, 0, 0.9);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: bold;
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
            }
            
            #bomb-bay-status.show {
                opacity: 1;
            }
            
            #bomb-bay-status.opening {
                background: rgba(255, 165, 0, 0.9);
                animation: pulse 1s infinite;
            }
            
            #bomb-bay-status.closing {
                background: rgba(255, 100, 0, 0.9);
                animation: pulse 1s infinite;
            }
            
            #bomb-bay-status.open {
                background: rgba(0, 255, 0, 0.9);
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            #missile-button {
                position: fixed;
                bottom: 20px;
                right: 120px;
                width: 80px;
                height: 80px;
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #ff4444;
                transition: border-color 0.3s ease, box-shadow 0.3s ease;
            }
            #missile-button.has-target {
                border-color: #00ff00;
                box-shadow: 0 0 15px rgba(0, 255, 0, 0.6);
            }
            #missile-icon {
                width: 50px;
                height: 50px;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23ff4444" d="M320 32c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7 14.3 32 32 32s32-14.3 32-32V32zM256 160c53 0 96 43 96 96s-43 96-96 96-96-43-96-96 43-96 96-96zM64 256c0-106 86-192 192-192s192 86 192 192-86 192-192 192S64 362 64 256z"/></svg>');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
                transition: filter 0.3s ease;
            }
            #missile-button.has-target #missile-icon {
                filter: hue-rotate(120deg) brightness(1.2);
            }
            #missile-cooldown {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 0;
                background-color: rgba(255, 68, 68, 0.4);
                z-index: 1;
                transition: height 0.1s linear;
            }
            #missile-button.unavailable {
                cursor: not-allowed;
            }
            #missile-button.unavailable #missile-icon {
                opacity: 0.5;
            }
            #countermeasure-button {
                position: fixed;
                bottom: 20px;
                right: 220px;
                width: 80px;
                height: 80px;
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #ffaa00;
                transition: border-color 0.3s ease, box-shadow 0.3s ease;
            }
            #countermeasure-button.has-iskander {
                border-color: #ff0000;
                box-shadow: 0 0 15px rgba(255, 0, 0, 0.6);
            }
            #countermeasure-icon {
                width: 50px;
                height: 50px;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23ffaa00" d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256s256-114.6 256-256S397.4 0 256 0zM256 464c-114.7 0-208-93.31-208-208S141.3 48 256 48s208 93.31 208 208S370.7 464 256 464zM256 304c13.25 0 24-10.75 24-24v-128C280 138.8 269.3 128 256 128S232 138.8 232 152v128C232 293.3 242.8 304 256 304zM256 337.1c-17.36 0-31.44 14.08-31.44 31.44C224.6 385.9 238.6 400 256 400s31.44-14.08 31.44-31.44C287.4 351.2 273.4 337.1 256 337.1z"/></svg>');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
                transition: filter 0.3s ease;
            }
            #countermeasure-button.has-iskander #countermeasure-icon {
                filter: hue-rotate(0deg) brightness(1.5);
            }
            #countermeasure-cooldown {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 0;
                background-color: rgba(255, 170, 0, 0.4);
                z-index: 1;
                transition: height 0.1s linear;
            }
            #countermeasure-button.unavailable {
                cursor: not-allowed;
            }
            #countermeasure-button.unavailable #countermeasure-icon {
                opacity: 0.5;
            }
            #camera-toggle-button {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 80px;
                height: 80px;
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #00ffff;
                transition: border-color 0.3s ease;
            }
            #camera-toggle-icon {
                width: 50px;
                height: 50px;
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
            }
            #camera-toggle-button[data-mode="ground"] {
                border-color: #00ff00;
            }
        `;
        document.head.appendChild(style);
    }

    private addHealthBarStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            #health-bar {
                position: fixed;
                top: 20px;
                left: 240px; /* Position to the right of radar overlay (20px + 200px + 20px gap) */
                width: 200px;
                height: 20px;
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 10px;
                overflow: hidden;
                border: 2px solid rgba(255, 255, 255, 0.3);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            }
            #health-bar-fill {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 255, 0, 0.4);
                transition: width 0.1s linear;
            }
            #health-text {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                text-align: center;
                line-height: 20px;
                color: #fff;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                font-weight: bold;
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
            }
        `;
        document.head.appendChild(style);
    }

    public update(): void {
        // Schedule updates for batching
        this.scheduleUpdate('bomb');
        this.scheduleUpdate('missile');
        this.scheduleUpdate('countermeasure');
        this.scheduleUpdate('camera');
        this.scheduleUpdate('health');
    }

    private scheduleUpdate(type: string): void {
        this.pendingUpdates.add(type);
        
        if (this.updateBatchTimeout) {
            clearTimeout(this.updateBatchTimeout);
        }
        
        this.updateBatchTimeout = setTimeout(() => {
            this.processBatchedUpdates();
        }, 16); // 60fps update rate
    }

    private processBatchedUpdates(): void {
        if (this.pendingUpdates.has('bomb')) {
            this.updateBombButton();
        }
        if (this.pendingUpdates.has('missile')) {
            this.updateMissileButton();
        }
        if (this.pendingUpdates.has('countermeasure')) {
            this.updateCountermeasureButton();
        }
        if (this.pendingUpdates.has('camera')) {
            this.updateCameraButton();
        }
        if (this.pendingUpdates.has('health')) {
            this.updateHealthBar();
        }
        
        this.pendingUpdates.clear();
    }

    private updateBombButton(): void {
        const cooldownStatus = this.game.getBombCooldownStatus();
        
        // Only update if changed
        if (Math.abs(cooldownStatus - this.lastBombCooldown) > 0.01) {
            const fillHeight = cooldownStatus * 100;
            this.bombButtonCooldown.style.height = `${fillHeight}%`;

            if (cooldownStatus >= 1) {
                this.bombButton.classList.remove('unavailable');
            } else {
                this.bombButton.classList.add('unavailable');
            }
            
            this.lastBombCooldown = cooldownStatus;
        }

        // Update bomb bay status
        const bomber = this.game.getBomber();
        const isBombingRun = this.game.isBombingRunActive();
        
        if (isBombingRun) {
            if (bomber.isBombBayOpening()) {
                this.bombBayStatus.className = 'show opening';
            } else if (bomber.isBombBayClosing()) {
                this.bombBayStatus.className = 'show closing';
            } else if (bomber.isBombBayOpen()) {
                this.bombBayStatus.className = 'show open';
            } else {
                this.bombBayStatus.className = '';
            }
        } else {
            this.bombBayStatus.className = '';
        }
    }

    private updateMissileButton(): void {
        const missileCooldownStatus = this.game.getBomber().getMissileCooldownStatus();
        
        // Only update cooldown if changed
        if (Math.abs(missileCooldownStatus - this.lastMissileCooldown) > 0.01) {
            const missileFillHeight = missileCooldownStatus * 100;
            this.missileButtonCooldown.style.height = `${missileFillHeight}%`;

            if (missileCooldownStatus >= 1) {
                this.missileButton.classList.remove('unavailable');
            } else {
                this.missileButton.classList.add('unavailable');
            }
            
            this.lastMissileCooldown = missileCooldownStatus;
        }

        // Update missile button target indicator
        const currentTime = Date.now();
        const shouldCheckTarget = missileCooldownStatus >= 1; // Only check when cooldown is ready
        
        if (shouldCheckTarget && (currentTime - this.lastTargetCheckTime > this.targetCheckInterval)) {
            this.cachedHasValidTarget = this.game.getBomber().hasValidTarget();
            this.lastTargetCheckTime = currentTime;
        }
        
        const hasTarget = this.cachedHasValidTarget && missileCooldownStatus >= 1;
        
        // Only update target indicator if changed
        if (hasTarget !== this.lastHasTarget) {
            if (hasTarget) {
                this.missileButton.classList.add('has-target');
            } else {
                this.missileButton.classList.remove('has-target');
            }
            this.lastHasTarget = hasTarget;
        }
    }

    private updateCountermeasureButton(): void {
        const countermeasureCooldownStatus = this.game.getBomber().getFlareCooldownStatus();
        
        // Only update cooldown if changed
        if (Math.abs(countermeasureCooldownStatus - this.lastCountermeasureCooldown) > 0.01) {
            const countermeasureFillHeight = countermeasureCooldownStatus * 100;
            this.countermeasureButtonCooldown.style.height = `${countermeasureFillHeight}%`;

            if (countermeasureCooldownStatus >= 1) {
                this.countermeasureButton.classList.remove('unavailable');
            } else {
                this.countermeasureButton.classList.add('unavailable');
            }
            
            this.lastCountermeasureCooldown = countermeasureCooldownStatus;
        }

        // Check if there are Iskander missiles in range to enable countermeasures
        const bomberPosition = this.game.getBomber().getPosition();
        const flareDetectionRange = this.game.getBomber().getFlareDetectionRange();
        
        // Check if any Iskander missiles are within flare detection range
        const hasIskanderInRange = this.game.hasIskanderMissilesInRange();
        
        if (countermeasureCooldownStatus >= 1 && hasIskanderInRange) {
            this.countermeasureButton.classList.add('has-iskander');
        } else {
            this.countermeasureButton.classList.remove('has-iskander');
        }
    }

    private updateCameraButton(): void {
        const lockMode = this.game.getCameraController().getLockMode();
        
        // Only update if changed
        if (lockMode !== this.lastLockMode) {
            this.cameraToggleButton.setAttribute('data-mode', lockMode);
            this.lastLockMode = lockMode;
        }
    }

    private updateHealthBar(): void {
        const currentHealth = this.game.getBomberHealth();
        
        // Only update if changed
        if (currentHealth !== this.lastHealth) {
            const fillWidth = Math.max(0, Math.min(100, currentHealth));
            this.healthBarFill.style.width = `${fillWidth}%`;
            this.healthText.textContent = `${currentHealth.toFixed(0)}%`;
            
            // Change color based on health level
            if (currentHealth > 60) {
                this.healthBarFill.style.backgroundColor = 'rgba(0, 255, 0, 0.8)';
            } else if (currentHealth > 30) {
                this.healthBarFill.style.backgroundColor = 'rgba(255, 255, 0, 0.8)';
            } else {
                this.healthBarFill.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            }
            
            this.lastHealth = currentHealth;
        }
    }

    public showAlert(message: string, type: string = 'default', duration: number = 5000): void {
        const alertId = `${type}-${Date.now()}`;
        
        // Remove existing alert of the same type
        const existingAlert = this.activeAlerts.get(type);
        if (existingAlert) {
            existingAlert.remove();
            this.activeAlerts.delete(type);
        }
        
        const alertElement = document.createElement('div');
        alertElement.className = `alert ${type}`;
        alertElement.textContent = message;
        
        this.alertContainer.appendChild(alertElement);
        this.activeAlerts.set(type, alertElement);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (this.activeAlerts.has(type)) {
                alertElement.classList.add('fade-out');
                setTimeout(() => {
                    if (alertElement.parentNode) {
                        alertElement.remove();
                        this.activeAlerts.delete(type);
                    }
                }, 500);
            }
        }, duration);
    }

    public removeAlert(type: string): void {
        const alertElement = this.activeAlerts.get(type);
        if (alertElement) {
            alertElement.classList.add('fade-out');
            setTimeout(() => {
                if (alertElement.parentNode) {
                    alertElement.remove();
                    this.activeAlerts.delete(type);
                }
            }, 500);
        }
    }
} 
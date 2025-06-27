import { Game } from "../game/Game";
import { InputManager } from "../game/InputManager";
import { CameraLockMode } from "../game/CameraController";

export class UIManager {
    private game: Game;
    private inputManager: InputManager;
    private bombButton!: HTMLElement;
    private bombButtonIcon!: HTMLElement;
    private bombButtonCooldown!: HTMLElement;
    private missileButton!: HTMLElement;
    private missileButtonIcon!: HTMLElement;
    private missileButtonCooldown!: HTMLElement;
    private cameraToggleButton!: HTMLElement;
    private cameraToggleIcon!: HTMLElement;
    
    // Performance optimization: cache target status
    private cachedHasValidTarget: boolean = false;
    private lastTargetCheckTime: number = 0;
    private targetCheckInterval: number = 0.2; // Check every 200ms instead of every frame

    constructor(game: Game, inputManager: InputManager) {
        this.game = game;
        this.inputManager = inputManager;
        this.createBombButton();
        this.createMissileButton();
        this.createCameraToggleButton();

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
        `;
        document.body.appendChild(this.bombButton);

        this.bombButtonIcon = document.getElementById('bomb-icon')!;
        this.bombButtonCooldown = document.getElementById('bomb-cooldown')!;

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

    public update(): void {
        // Update bomb button
        const cooldownStatus = this.game.getBombCooldownStatus();
        const fillHeight = cooldownStatus * 100;
        this.bombButtonCooldown.style.height = `${fillHeight}%`;

        if (cooldownStatus >= 1) {
            this.bombButton.classList.remove('unavailable');
        } else {
            this.bombButton.classList.add('unavailable');
        }

        // Update missile button
        const missileCooldownStatus = this.game.getBomber().getMissileCooldownStatus();
        const missileFillHeight = missileCooldownStatus * 100;
        this.missileButtonCooldown.style.height = `${missileFillHeight}%`;

        if (missileCooldownStatus >= 1) {
            this.missileButton.classList.remove('unavailable');
        } else {
            this.missileButton.classList.add('unavailable');
        }

        // Update missile button target indicator
        const currentTime = Date.now();
        const shouldCheckTarget = missileCooldownStatus >= 1; // Only check when cooldown is ready
        
        if (shouldCheckTarget && (currentTime - this.lastTargetCheckTime > this.targetCheckInterval)) {
            this.cachedHasValidTarget = this.game.getBomber().hasValidTarget();
            this.lastTargetCheckTime = currentTime;
        }
        
        if (this.cachedHasValidTarget && missileCooldownStatus >= 1) {
            this.missileButton.classList.add('has-target');
        } else {
            this.missileButton.classList.remove('has-target');
        }

        // Update camera toggle button appearance
        const lockMode = this.game.getCameraController().getLockMode();
        this.cameraToggleButton.setAttribute('data-mode', lockMode);
    }
} 
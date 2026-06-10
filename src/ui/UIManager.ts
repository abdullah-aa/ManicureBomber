import { Game } from '../managers/Game';
import { InputManager } from '../managers/InputManager';

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
  private aiToggleButton!: HTMLElement;
  private touchCameraToggleButton!: HTMLElement;
  private touchCameraToggleIcon!: HTMLElement;
  private mobileZoomControl!: HTMLElement;
  private zoomInButton!: HTMLElement;
  private zoomOutButton!: HTMLElement;
  private healthBar!: HTMLElement;
  private healthBarFill!: HTMLElement;
  private healthText!: HTMLElement;

  // Performance optimization: cache target status
  private cachedHasValidTarget: boolean = false;
  private lastTargetCheckTime: number = 0;
  private targetCheckInterval: number = 200; // ms — compared against Date.now() deltas

  // Performance optimization: change detection and batching
  private lastBombCooldown: number = -1;
  private lastMissileCooldown: number = -1;
  private lastCountermeasureCooldown: number = -1;
  private lastHasTarget: boolean = false;
  private lastShowCrosshairs: boolean = false;
  private lastHealth: number = -1;
  private lastAIEnabled: boolean = false;
  private lastAISuspended: boolean = false;
  private lastHasIskander: boolean = false;

  // Alert system
  private alertContainer!: HTMLElement;
  private activeAlerts: Map<string, HTMLElement> = new Map();

  // Persistent alert tracking for Iskander missiles
  private persistentAlerts: Set<string> = new Set();
  private iskanderAlertId: string = 'iskander-lock';

  constructor(game: Game, inputManager: InputManager) {
    this.game = game;
    this.inputManager = inputManager;
    this.createBombButton();
    this.createMissileButton();
    this.createCountermeasureButton();
    this.createCameraToggleButton();
    this.createAIToggleButton();
    this.createTouchCameraToggleButton();
    this.createMobileZoomControl();
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
      if (this.game.getBomber().canLaunchMissile()) {
        // Use promise-based callback instead of await
        this.game
          .getBomber()
          .hasValidTarget()
          .then((hasValidTarget) => {
            if (hasValidTarget) {
              this.inputManager.triggerMissileKeyPress();
            }
          })
          .catch(() => {
            // Silent error handling
          });
      }
    });

    // Listen for countermeasure button clicks
    this.countermeasureButton.addEventListener('click', () => {
      if (this.game.getBomber().canLaunchFlares() && this.game.hasIskanderMissilesForAlert()) {
        this.inputManager.triggerCountermeasureKeyPress();
      }
    });

    // Listen for camera toggle button clicks
    this.cameraToggleButton.addEventListener('click', () => {
      this.game.getCameraController().toggleGroundCrosshairs();
      this.updateCameraToggleIcon();
    });

    // Listen for AI toggle button clicks
    this.aiToggleButton.addEventListener('click', () => {
      const aiController = this.game.getAIController();
      aiController.setEnabled(!aiController.isEnabled());
      this.showAlert(aiController.isEnabled() ? 'AUTOPILOT ENGAGED' : 'AUTOPILOT OFF', 'default', 2000);
      this.updateAIToggleButton(true);
    });

    // Listen for touch camera toggle button clicks (mobile only)
    if (this.touchCameraToggleButton) {
      this.touchCameraToggleButton.addEventListener('click', () => {
        const currentMode = this.inputManager.getTouchCameraMode();
        this.inputManager.setTouchCameraMode(!currentMode);
        this.updateTouchCameraToggleIcon();
        // Navigate mode always keeps the camera behind the plane: leaving camera
        // mode swings the camera back to its follow position.
        if (!this.inputManager.getTouchCameraMode()) {
          this.game.getCameraController().snapBehindBomber();
        }
      });
    }
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

  private createAIToggleButton(): void {
    this.aiToggleButton = document.createElement('div');
    this.aiToggleButton.id = 'ai-toggle-button';
    this.aiToggleButton.innerHTML = `
            <div id="ai-toggle-icon">AI</div>
        `;
    document.body.appendChild(this.aiToggleButton);
  }

  private createTouchCameraToggleButton(): void {
    this.touchCameraToggleButton = document.createElement('div');
    this.touchCameraToggleButton.id = 'touch-camera-toggle-button';
    this.touchCameraToggleButton.innerHTML = `
            <div id="touch-camera-toggle-icon"></div>
        `;
    document.body.appendChild(this.touchCameraToggleButton);

    this.touchCameraToggleIcon = document.getElementById('touch-camera-toggle-icon')!;
    this.updateTouchCameraToggleIcon();
  }

  private createMobileZoomControl(): void {
    this.mobileZoomControl = document.createElement('div');
    this.mobileZoomControl.id = 'mobile-zoom-control';
    this.mobileZoomControl.innerHTML = `
      <div id="zoom-out-button">-</div>
      <div id="zoom-icon">🔍</div>
      <div id="zoom-in-button">+</div>
    `;
    document.body.appendChild(this.mobileZoomControl);

    this.zoomOutButton = document.getElementById('zoom-out-button')!;
    this.zoomInButton = document.getElementById('zoom-in-button')!;

    // Add event listeners
    this.zoomOutButton.addEventListener('click', () => {
      this.inputManager.simulateWheelZoom(100); // Zoom out
    });

    this.zoomInButton.addEventListener('click', () => {
      this.inputManager.simulateWheelZoom(-100); // Zoom in
    });

    // Hide by default (will be shown when camera mode is enabled)
    this.mobileZoomControl.style.display = 'none';
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
                top: 50px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 2000;
                pointer-events: none;
            }
            
            .alert {
                background: linear-gradient(135deg, rgba(255, 0, 0, 0.9), rgba(200, 0, 0, 0.9));
                color: white;
                padding: 6px 12px;
                margin-bottom: 10px;
                border-radius: 6px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                font-family: 'Courier New', monospace;
                font-weight: bold;
                font-size: 12px;
                text-align: center;
                min-width: 100px;
                width: fit-content;
                animation: alertSlideIn 0.3s ease-out;
                backdrop-filter: blur(5px);
            }
            
            .alert.iskander-lock {
                background: linear-gradient(135deg, rgba(255, 100, 0, 0.9), rgba(255, 50, 0, 0.9));
                border-color: rgba(255, 255, 0, 0.5);
                box-shadow: 0 4px 12px rgba(255, 100, 0, 0.3);
                animation: iskanderPulse 2s infinite;
            }
            
            @keyframes iskanderPulse {
                0%, 100% { 
                    box-shadow: 0 4px 12px rgba(255, 100, 0, 0.3);
                    border-color: rgba(255, 255, 0, 0.5);
                }
                50% { 
                    box-shadow: 0 4px 20px rgba(255, 100, 0, 0.6);
                    border-color: rgba(255, 255, 0, 0.8);
                }
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
                }
                to {
                    opacity: 0;
                }
            }
            
            /* Mobile portrait adjustments to avoid blocking radar and camera toggle */
            @media screen and (max-width: 768px) and (orientation: portrait) {
                #alert-container {
                    top: 120px;
                }
            }
        `;
    document.head.appendChild(style);
  }

  public updateCameraToggleIcon(): void {
    const showCrosshairs = this.game.getCameraController().getShowGroundCrosshairs();
    // Downward arrow target icon for crosshairs toggle
    this.cameraToggleIcon.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="${showCrosshairs ? '%2300ff00' : '%23ffffff'}" d="M179.641,189.565c2.455,0,4.869,0.193,7.223,0.561l36.999-36.998c-13.193-7.048-28.249-11.051-44.221-11.051 c-51.92,0-94.162,42.241-94.162,94.162c0,51.921,42.242,94.162,94.162,94.162s94.161-42.241,94.161-94.162 c0-15.973-4.002-31.027-11.051-44.22l-36.997,36.999c0.367,2.354,0.56,4.766,0.56,7.222c0,25.736-20.937,46.674-46.672,46.674 c-25.736,0-46.674-20.938-46.674-46.674S153.905,189.565,179.641,189.565z"></path> <path fill="${showCrosshairs ? '%2300ff00' : '%23ffffff'}" d="M290.454,164.316c13.488,20.712,21.338,45.417,21.338,71.922c0,72.87-59.281,132.153-132.15,132.153 c-72.869,0-132.153-59.283-132.153-132.152s59.283-132.153,132.152-132.153c26.508,0,51.211,7.851,71.924,21.34l34.104-34.104 c-29.738-21.817-66.402-34.724-106.027-34.724c-99.055,0-179.641,80.587-179.641,179.641c0,99.054,80.586,179.642,179.641,179.642 c99.054,0,179.638-80.588,179.638-179.642c0-39.626-12.904-76.29-34.721-106.026L290.454,164.316z"></path> <path fill="%23ff0000" d="M415.415,56.64c-1.119-3.539-4.119-6.157-7.775-6.793l-35.449-6.157l-6.156-35.45c-0.637-3.656-3.256-6.655-6.793-7.774 c-3.537-1.122-7.402-0.178-10.027,2.447l-27.412,27.411c-1.863,1.864-2.91,4.393-2.912,7.029l0.002,40.896l-148.1,148.096 c-5.176,5.177-5.176,13.566,0,18.743c5.178,5.175,13.568,5.177,18.744,0L337.632,96.991h40.896c2.635,0,5.164-1.047,7.027-2.911 l27.412-27.413C415.593,64.044,416.536,60.177,415.415,56.64z"></path></svg>')`;
  }

  public updateTouchCameraToggleIcon(): void {
    if (!this.touchCameraToggleIcon) return; // Only update if button exists (mobile only)

    const isCameraMode = this.inputManager.getTouchCameraMode();
    // Camera icon when camera mode is enabled, bomber icon when bomber mode is enabled
    if (isCameraMode) {
      // Camera icon - Simple eye with crosshairs
      this.touchCameraToggleIcon.innerHTML = `📹`;
      // Show zoom control when camera mode is enabled
      if (this.mobileZoomControl) {
        this.mobileZoomControl.style.display = 'flex';
      }
    } else {
      // Bomber icon - Simple aircraft shape
      this.touchCameraToggleIcon.innerHTML = `✈️`;
      // Hide zoom control when camera mode is disabled
      if (this.mobileZoomControl) {
        this.mobileZoomControl.style.display = 'none';
      }
    }
  }

  private addStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
            #bomb-button {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: min(80px, 10vw);
                height: min(80px, 10vw);
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
                width: min(50px, 6.25vw);
                height: min(50px, 6.25vw);
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
                right: calc(20px + min(80px, 10vw) + 20px);
                width: min(80px, 10vw);
                height: min(80px, 10vw);
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
                width: min(50px, 6.25vw);
                height: min(50px, 6.25vw);
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
                right: calc(20px + min(80px, 10vw) * 2 + 40px);
                width: min(80px, 10vw);
                height: min(80px, 10vw);
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
                width: min(50px, 6.25vw);
                height: min(50px, 6.25vw);
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
                bottom: calc(20px + min(80px, 10vw) + 20px);
                right: 20px;
                width: min(45px, 6vw);
                height: min(45px, 6vw);
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #ffffff;
                transition: border-color 0.3s ease;
            }
            #camera-toggle-icon {
                margin-top: min(5px, 0.6vw);
                margin-left: min(7px, 0.9vw);
                width: min(32px, 4vw);
                height: min(32px, 4vw);
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
            }
            #ai-toggle-button {
                position: fixed;
                top: 50px;
                right: 20px;
                width: min(45px, 6vw);
                height: min(45px, 6vw);
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #ffffff;
                transition: border-color 0.3s ease, box-shadow 0.3s ease;
            }
            #ai-toggle-icon {
                color: #ffffff;
                font-family: 'Courier New', monospace;
                font-size: clamp(12px, 1.8vw, 16px);
                font-weight: bold;
                z-index: 2;
                user-select: none;
            }
            #ai-toggle-button.active {
                border-color: #00ff00;
                box-shadow: 0 0 15px rgba(0, 255, 0, 0.6);
            }
            #ai-toggle-button.active #ai-toggle-icon {
                color: #00ff00;
            }
            #ai-toggle-button.suspended {
                border-color: #ffaa00;
                box-shadow: 0 0 15px rgba(255, 170, 0, 0.6);
            }
            #ai-toggle-button.suspended #ai-toggle-icon {
                color: #ffaa00;
            }
            #touch-camera-toggle-button {
                position: fixed;
                top: 50px;
                right: calc(20px + min(45px, 6vw) + 10px);
                width: min(45px, 6vw);
                height: min(45px, 6vw);
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                border: 2px solid #ffffff;
                transition: border-color 0.3s ease;
            }
            #touch-camera-toggle-icon {
                width: min(28px, 3.5vw);
                height: min(28px, 3.5vw);
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                z-index: 2;
            }
            #mobile-zoom-control {
                position: fixed;
                bottom: 20px;
                left: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                background-color: rgba(0, 0, 0, 0.7);
                border-radius: 20px;
                padding: 8px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                gap: 6px;
            }
            #zoom-out-button, #zoom-in-button {
                width: 32px;
                height: 32px;
                background-color: rgba(255, 255, 255, 0.1);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 18px;
                font-weight: bold;
                cursor: pointer;
                user-select: none;
                transition: background-color 0.3s ease;
            }
            #zoom-out-button:active, #zoom-in-button:active {
                background-color: rgba(255, 255, 255, 0.3);
            }
            #zoom-icon {
                font-size: 16px;
                color: white;
                user-select: none;
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
                right: 20px;
                width: min(200px, 25vw);
                height: min(20px, 2.5vw);
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: min(10px, 1.25vw);
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
                line-height: min(20px, 2.5vw);
                color: #fff;
                font-family: 'Courier New', monospace;
                font-size: clamp(10px, 1.5vw, 12px);
                font-weight: bold;
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
            }
        `;
    document.head.appendChild(style);

    // Mobile control sizing
    const mobileStyle = document.createElement('style');
    mobileStyle.textContent = `
        #bomb-button, #missile-button, #countermeasure-button {
          width: 50px !important;
          height: 50px !important;
        }

        #bomb-icon, #missile-icon, #countermeasure-icon {
          width: 30px !important;
          height: 30px !important;
        }

        #missile-button {
          right: calc(20px + 50px + 10px) !important;
        }

        #countermeasure-button {
          right: calc(20px + 50px * 2 + 20px) !important;
        }

        #camera-toggle-button {
          bottom: calc(20px + 50px + 10px) !important;
          width: 35px !important;
          height: 35px !important;
        }

        #camera-toggle-icon {
          width: 20px !important;
          height: 20px !important;
          margin: 2px 0 0 4px !important;
        }

        #ai-toggle-icon {
          font-size: 12px !important;
        }

        #ai-toggle-button, #touch-camera-toggle-button {
          width: 35px !important;
          height: 35px !important;
        }

        #touch-camera-toggle-icon {
          width: 20px !important;
          height: 20px !important;
        }

        #touch-camera-toggle-button {
          right: calc(20px + 35px + 12px) !important;
        }

        #health-bar {
          width: 160px !important;
          height: 18px !important;
        }

        #health-text {
          line-height: 18px !important;
          font-size: 11px !important;
        }
      `;
    document.head.appendChild(mobileStyle);
  }

  // Called every uiUpdateInterval (50ms) from the game loop. Every widget already
  // does its own change detection, so update directly — the old setTimeout batching
  // added 7 timer create/clear cycles per tick for nothing.
  public update(): void {
    this.updateBombButton();
    this.updateMissileButton();
    this.updateCountermeasureButton();
    this.updateCameraButton();
    this.updateTouchCameraToggleIcon();
    this.updateAIToggleButton();
    this.updateHealthBar();
    this.updateIskanderAlert();
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

    if (shouldCheckTarget && currentTime - this.lastTargetCheckTime > this.targetCheckInterval) {
      // Use promise-based callback instead of await
      this.game
        .getBomber()
        .hasValidTarget()
        .then((hasValidTarget) => {
          this.cachedHasValidTarget = hasValidTarget;
          this.lastTargetCheckTime = currentTime;

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
        })
        .catch(() => {
          // Silent error handling - keep previous cached value
        });
    } else {
      // Use cached value if not checking
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

    // Check if there are Iskander missiles with lock detected to enable countermeasures
    // Use the same conditions as the alert system - missiles that are locked on OR have started locking
    const hasIskander = countermeasureCooldownStatus >= 1 && this.game.hasIskanderMissilesForAlert();

    // Only touch the DOM on change
    if (hasIskander !== this.lastHasIskander) {
      this.countermeasureButton.classList.toggle('has-iskander', hasIskander);
      this.lastHasIskander = hasIskander;
    }
  }

  private updateAIToggleButton(force: boolean = false): void {
    const aiController = this.game.getAIController();
    const enabled = aiController.isEnabled();
    const suspended = aiController.isSuspended();

    // Only update if changed
    if (!force && enabled === this.lastAIEnabled && suspended === this.lastAISuspended) {
      return;
    }
    this.lastAIEnabled = enabled;
    this.lastAISuspended = suspended;

    this.aiToggleButton.classList.toggle('suspended', enabled && suspended);
    this.aiToggleButton.classList.toggle('active', enabled && !suspended);
  }

  private updateCameraButton(): void {
    const showCrosshairs = this.game.getCameraController().getShowGroundCrosshairs();

    // Only update if changed
    if (showCrosshairs !== this.lastShowCrosshairs) {
      this.updateCameraToggleIcon();
      this.lastShowCrosshairs = showCrosshairs;
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

    // Check if this is a persistent alert
    if (type === this.iskanderAlertId) {
      this.persistentAlerts.add(type);
      // Don't set auto-remove timeout for persistent alerts
    } else {
      // Auto-remove after duration for non-persistent alerts
      setTimeout(() => {
        if (this.activeAlerts.has(type) && !this.persistentAlerts.has(type)) {
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
  }

  public showPersistentAlert(message: string, type: string): void {
    this.showAlert(message, type, 0); // 0 duration means persistent
  }

  public removePersistentAlert(type: string): void {
    if (this.persistentAlerts.has(type)) {
      this.persistentAlerts.delete(type);
      this.removeAlert(type);
    }
  }

  public updateIskanderAlert(): void {
    // Check if there are any active Iskander missiles using the larger alert detection range
    const hasActiveIskanderMissiles = this.game.hasIskanderMissilesForAlert();

    if (hasActiveIskanderMissiles) {
      // Show or maintain the alert with single message
      if (!this.activeAlerts.has(this.iskanderAlertId)) {
        this.showPersistentAlert('⚠️ LOCKED', this.iskanderAlertId);
      }
    } else {
      // Remove the alert if no active missiles
      this.removePersistentAlert(this.iskanderAlertId);
    }
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

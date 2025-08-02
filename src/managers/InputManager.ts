import { Scene, PointerEventTypes } from '@babylonjs/core';

interface Keybind {
  name: string;
  displayName: string;
  defaultKey: string;
  currentKey: string;
}

export class InputManager {
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private keys: { [key: string]: boolean } = {};
  private wheelDelta: number = 0;

  // Keybinding system
  private keybinds: Keybind[] = [
    { name: 'altitudeUp', displayName: 'Altitude Up', defaultKey: 'KeyW', currentKey: 'KeyW' },
    { name: 'altitudeDown', displayName: 'Altitude Down', defaultKey: 'KeyS', currentKey: 'KeyS' },
    { name: 'turnLeft', displayName: 'Turn Left', defaultKey: 'KeyA', currentKey: 'KeyA' },
    { name: 'turnRight', displayName: 'Turn Right', defaultKey: 'KeyD', currentKey: 'KeyD' },
    { name: 'cameraPanLeft', displayName: 'Camera Pan Left', defaultKey: 'KeyZ', currentKey: 'KeyZ' },
    { name: 'cameraPanRight', displayName: 'Camera Pan Right', defaultKey: 'KeyC', currentKey: 'KeyC' },
    { name: 'pitchUp', displayName: 'Pitch Up', defaultKey: 'KeyQ', currentKey: 'KeyQ' },
    { name: 'pitchDown', displayName: 'Pitch Down', defaultKey: 'KeyE', currentKey: 'KeyE' },
    { name: 'cameraReset', displayName: 'Reset Camera', defaultKey: 'Digit2', currentKey: 'Digit2' },
    { name: 'cameraZoomIn', displayName: 'Zoom In', defaultKey: 'Digit1', currentKey: 'Digit1' },
    { name: 'cameraZoomOut', displayName: 'Zoom Out', defaultKey: 'Digit3', currentKey: 'Digit3' },
    { name: 'countermeasure', displayName: 'Deploy Flares', defaultKey: 'KeyF', currentKey: 'KeyF' },
    { name: 'missile', displayName: 'Launch Tomahawk', defaultKey: 'KeyR', currentKey: 'KeyR' },
    { name: 'cameraToggle', displayName: 'Toggle Crosshairs', defaultKey: 'Digit4', currentKey: 'Digit4' },
    { name: 'bomb', displayName: 'Start Bombing Run', defaultKey: 'KeyX', currentKey: 'KeyX' }
  ];


  // Mouse controls
  private isMouseDragging: boolean = false;
  private mouseDeltaX: number = 0;
  private mouseDeltaY: number = 0;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Cache frequently accessed keys to reduce lookup overhead
  private cachedKeys: { [key: string]: boolean } = {};
  private keyCacheValid: boolean = false;
  private lastKeyCacheUpdate: number = 0;
  private keyCacheInterval: number = 16; // Update cache every 16ms (~60fps)

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;
    this.loadKeybindsFromStorage();
    this.setupKeyboardInput();
    this.setupMouseInput();
  }

  private setupMouseInput(): void {
    this.canvas.addEventListener('wheel', (event) => {
      this.wheelDelta += event.deltaY;
      event.preventDefault();
    });

    // Use Babylon.js pointer events instead of DOM events
    this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          if (pointerInfo.event.button === 0) { // Left mouse button
            this.isMouseDragging = true;
            this.lastMouseX = pointerInfo.event.clientX;
            this.lastMouseY = pointerInfo.event.clientY;
          }
          break;
          
        case PointerEventTypes.POINTERMOVE:
          if (this.isMouseDragging) {
            this.mouseDeltaX = pointerInfo.event.clientX - this.lastMouseX;
            this.mouseDeltaY = pointerInfo.event.clientY - this.lastMouseY;
            this.lastMouseX = pointerInfo.event.clientX;
            this.lastMouseY = pointerInfo.event.clientY;
          }
          break;
          
        case PointerEventTypes.POINTERUP:
          if (pointerInfo.event.button === 0) { // Left mouse button
            this.isMouseDragging = false;
          }
          break;
      }
    });
  }

  private setupKeyboardInput(): void {
    // Handle keydown events
    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true;
      this.keyCacheValid = false; // Invalidate cache when keys change
      event.preventDefault();
    });

    // Handle keyup events
    window.addEventListener('keyup', (event) => {
      this.keys[event.code] = false;
      this.keyCacheValid = false; // Invalidate cache when keys change
      event.preventDefault();
    });

    // Clear keys when window loses focus
    window.addEventListener('blur', () => {
      this.keys = {};
      this.keyCacheValid = false; // Invalidate cache when clearing keys
    });
  }

  public getWheelDelta(): number {
    return this.wheelDelta;
  }

  public endFrame(): void {
    this.wheelDelta = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  // Mouse input methods
  public getMouseDeltaX(): number {
    return this.mouseDeltaX;
  }

  public getMouseDeltaY(): number {
    return this.mouseDeltaY;
  }

  public getIsMouseDragging(): boolean {
    return this.isMouseDragging;
  }

  public isKeyPressed(key: string): boolean {
    // Cache frequently accessed keys to reduce lookup overhead
    const currentTime = performance.now();
    if (!this.keyCacheValid || currentTime - this.lastKeyCacheUpdate > this.keyCacheInterval) {
      // Cache all current keybind keys
      this.keybinds.forEach(keybind => {
        this.cachedKeys[keybind.currentKey] = this.keys[keybind.currentKey] || false;
      });
      this.keyCacheValid = true;
      this.lastKeyCacheUpdate = currentTime;
    }

    // Use cached values if available
    if (this.cachedKeys.hasOwnProperty(key)) {
      return this.cachedKeys[key];
    }
    
    return this.keys[key] || false;
  }

  public isBombKeyPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'bomb');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isMissileKeyPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'missile');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCountermeasureKeyPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'countermeasure');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public triggerBombKeyPress(): void {
    const keybind = this.keybinds.find(k => k.name === 'bomb');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  public triggerMissileKeyPress(): void {
    const keybind = this.keybinds.find(k => k.name === 'missile');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  public triggerCountermeasureKeyPress(): void {
    const keybind = this.keybinds.find(k => k.name === 'countermeasure');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  // Bomber movement controls
  public isAltitudeUpPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'altitudeUp');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isAltitudeDownPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'altitudeDown');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public getTurnLeftPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'turnLeft');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public getTurnRightPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'turnRight');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  // Camera controls
  public isCameraPanLeftPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraPanLeft');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCameraPanRightPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraPanRight');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isPitchUpPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'pitchUp');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isPitchDownPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'pitchDown');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCameraResetPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraReset');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCameraTogglePressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraToggle');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCameraZoomInPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraZoomIn');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCameraZoomOutPressed(): boolean {
    const keybind = this.keybinds.find(k => k.name === 'cameraZoomOut');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  // Keybinding management
  public getKeybinds(): Keybind[] {
    return [...this.keybinds];
  }

  public updateKeybind(name: string, newKey: string): void {
    const keybind = this.keybinds.find(k => k.name === name);
    if (keybind) {
      keybind.currentKey = newKey;
      this.keyCacheValid = false; // Invalidate cache
      this.saveKeybindsToStorage();
    }
  }

  public resetKeybinds(): void {
    this.keybinds.forEach(keybind => {
      keybind.currentKey = keybind.defaultKey;
    });
    this.keyCacheValid = false; // Invalidate cache
    this.saveKeybindsToStorage();
  }

  private saveKeybindsToStorage(): void {
    const keybindData = {
      keybinds: this.keybinds
    };
    localStorage.setItem('manicureBomberKeybinds', JSON.stringify(keybindData));
  }

  private loadKeybindsFromStorage(): void {
    const saved = localStorage.getItem('manicureBomberKeybinds');
    if (saved) {
      try {
        const keybindData = JSON.parse(saved);
        if (keybindData.keybinds) {
          // Update current keys from saved data
          keybindData.keybinds.forEach((savedKeybind: Keybind) => {
            const keybind = this.keybinds.find(k => k.name === savedKeybind.name);
            if (keybind) {
              keybind.currentKey = savedKeybind.currentKey;
            }
          });
        }
      } catch (e) {
        console.warn('Failed to load keybinds from storage:', e);
      }
    }
  }

  public getKeys(): { [key: string]: boolean } {
    return { ...this.keys };
  }
}

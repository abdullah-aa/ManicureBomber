import { Scene, PointerEventTypes } from '@babylonjs/core';

interface Keybind {
  name: string;
  currentKey: string;
}

export class InputManager {
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private keys: { [key: string]: boolean } = {};
  private wheelDelta: number = 0;

  // Internal action -> key-code registry. The game is touch-only, so these keys
  // are never produced by a physical keyboard; they are the codes that on-screen
  // buttons and touch-to-key simulation write into the `keys` map.
  private keybinds: Keybind[] = [
    { name: 'altitudeUp', currentKey: 'KeyW' },
    { name: 'altitudeDown', currentKey: 'KeyS' },
    { name: 'turnLeft', currentKey: 'KeyA' },
    { name: 'turnRight', currentKey: 'KeyD' },
    { name: 'countermeasure', currentKey: 'KeyF' },
    { name: 'missile', currentKey: 'KeyR' },
    { name: 'bomb', currentKey: 'KeyX' },
  ];

  // Mouse controls
  private isMouseDragging: boolean = false;
  private mouseDeltaX: number = 0;
  private mouseDeltaY: number = 0;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Touch controls
  private touchPointers: Map<number, { x: number; y: number }> = new Map();
  private lastTouchCenter: { x: number; y: number } | null = null;
  private touchDeltaX: number = 0;
  private touchDeltaY: number = 0;
  private isTouchCameraMode: boolean = false; // true when UI toggle enables camera mode
  private bomberTouchDeltaX: number = 0;
  private bomberTouchDeltaY: number = 0;

  // Touch-to-key simulation
  private touchStartPosition: { x: number; y: number } | null = null;
  private touchSimulatedKeys: { [key: string]: boolean } = {};
  private touchDeadZone: number = 20; // pixels before movement is registered

  // Cache frequently accessed keys to reduce lookup overhead
  private cachedKeys: { [key: string]: boolean } = {};
  private keyCacheValid: boolean = false;
  private lastKeyCacheUpdate: number = 0;
  private keyCacheInterval: number = 16; // Update cache every 16ms (~60fps)

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;
    this.setupMouseInput();
  }

  private setupMouseInput(): void {
    // Use Babylon.js pointer events for mouse controls
    this.scene.onPointerObservable.add((pointerInfo) => {
      const event = pointerInfo.event;

      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          if (event.button === 0) {
            // Left mouse button
            this.isMouseDragging = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
          }
          break;

        case PointerEventTypes.POINTERMOVE:
          if (this.isMouseDragging) {
            this.mouseDeltaX = event.clientX - this.lastMouseX;
            this.mouseDeltaY = event.clientY - this.lastMouseY;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
          }
          break;

        case PointerEventTypes.POINTERUP:
          if (event.button === 0) {
            // Left mouse button
            this.isMouseDragging = false;
          }
          break;
      }
    });

    // Add separate touch event listeners for touch controls
    this.canvas.addEventListener('touchstart', (event) => {
      event.preventDefault();

      this.touchPointers.clear();
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        this.touchPointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }

      // Set initial touch position for movement simulation
      if (event.touches.length === 1 && !this.isTouchCameraMode) {
        const touch = event.touches[0];
        this.touchStartPosition = { x: touch.clientX, y: touch.clientY };
      }

      this.updateTouchState();
    });

    this.canvas.addEventListener('touchmove', (event) => {
      event.preventDefault();

      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        this.touchPointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }

      // Update touch-to-key simulation for bomber movement
      if (!this.isTouchCameraMode && this.touchStartPosition && event.touches.length === 1) {
        this.updateTouchToKeySimulation(event.touches[0]);
      }

      this.updateTouchMovement();
    });

    this.canvas.addEventListener('touchend', (event) => {
      event.preventDefault();

      // Remove ended touches
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        this.touchPointers.delete(touch.identifier);
      }

      // Clear touch simulation when touch ends
      if (this.touchPointers.size === 0) {
        this.clearTouchSimulation();
      }

      this.updateTouchState();
    });

    this.canvas.addEventListener('touchcancel', (event) => {
      event.preventDefault();
      this.touchPointers.clear();
      this.clearTouchSimulation();
      this.updateTouchState();
    });
  }

  public getWheelDelta(): number {
    return this.wheelDelta;
  }

  public simulateWheelZoom(delta: number): void {
    this.wheelDelta += delta;
  }

  public endFrame(): void {
    this.wheelDelta = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.bomberTouchDeltaX = 0;
    this.bomberTouchDeltaY = 0;
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

  // Touch input methods
  public getTouchDeltaX(): number {
    return this.touchDeltaX;
  }

  public getTouchDeltaY(): number {
    return this.touchDeltaY;
  }

  public getIsTouchCamera(): boolean {
    return this.isTouchCameraMode && this.touchPointers.size > 0;
  }

  public getBomberTouchDeltaX(): number {
    return this.bomberTouchDeltaX;
  }

  public getBomberTouchDeltaY(): number {
    return this.bomberTouchDeltaY;
  }

  public getIsTouchActive(): boolean {
    return this.touchPointers.size > 0;
  }

  public setTouchCameraMode(enabled: boolean): void {
    this.isTouchCameraMode = enabled;
  }

  public getTouchCameraMode(): boolean {
    return this.isTouchCameraMode;
  }

  public isKeyPressed(key: string): boolean {
    // Check touch-simulated keys first
    if (this.touchSimulatedKeys[key]) {
      return true;
    }

    // Cache frequently accessed keys to reduce lookup overhead
    const currentTime = performance.now();
    if (!this.keyCacheValid || currentTime - this.lastKeyCacheUpdate > this.keyCacheInterval) {
      // Cache all current keybind keys
      this.keybinds.forEach((keybind) => {
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
    const keybind = this.keybinds.find((k) => k.name === 'bomb');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isMissileKeyPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'missile');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isCountermeasureKeyPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'countermeasure');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public triggerBombKeyPress(): void {
    const keybind = this.keybinds.find((k) => k.name === 'bomb');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  public triggerMissileKeyPress(): void {
    const keybind = this.keybinds.find((k) => k.name === 'missile');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  public triggerCountermeasureKeyPress(): void {
    const keybind = this.keybinds.find((k) => k.name === 'countermeasure');
    if (keybind) {
      this.keys[keybind.currentKey] = true;
      setTimeout(() => {
        this.keys[keybind.currentKey] = false;
      }, 100);
    }
  }

  // Bomber movement controls
  public isAltitudeUpPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'altitudeUp');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public isAltitudeDownPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'altitudeDown');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public getTurnLeftPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'turnLeft');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  public getTurnRightPressed(): boolean {
    const keybind = this.keybinds.find((k) => k.name === 'turnRight');
    return keybind ? this.isKeyPressed(keybind.currentKey) : false;
  }

  private updateTouchState(): void {
    if (this.touchPointers.size === 0) {
      this.lastTouchCenter = null;
    }
  }

  private updateTouchMovement(): void {
    if (this.touchPointers.size === 0) return;

    // Calculate center point of all touches
    let centerX = 0;
    let centerY = 0;

    for (const touch of this.touchPointers.values()) {
      centerX += touch.x;
      centerY += touch.y;
    }

    centerX /= this.touchPointers.size;
    centerY /= this.touchPointers.size;

    if (this.lastTouchCenter) {
      const deltaX = centerX - this.lastTouchCenter.x;
      const deltaY = centerY - this.lastTouchCenter.y;

      if (this.isTouchCameraMode) {
        // Camera control mode - swipe moves camera
        this.touchDeltaX = deltaX;
        this.touchDeltaY = deltaY;
        this.bomberTouchDeltaX = 0;
        this.bomberTouchDeltaY = 0;
      } else {
        // Bomber control mode - swipe moves bomber
        this.bomberTouchDeltaX = deltaX;
        this.bomberTouchDeltaY = deltaY;
        this.touchDeltaX = 0;
        this.touchDeltaY = 0;
      }
    }

    this.lastTouchCenter = { x: centerX, y: centerY };
  }

  private updateTouchToKeySimulation(touch: Touch): void {
    if (!this.touchStartPosition) return;

    const deltaX = touch.clientX - this.touchStartPosition.x;
    const deltaY = touch.clientY - this.touchStartPosition.y;

    // Clear all touch-simulated keys but preserve touch start position
    this.touchSimulatedKeys = {};

    // Check if movement is beyond dead zone
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance < this.touchDeadZone) {
      return;
    }

    // Simulate key presses based on touch direction
    const altitudeKeybind = this.keybinds.find((k) => k.name === 'altitudeUp');
    const altitudeDownKeybind = this.keybinds.find((k) => k.name === 'altitudeDown');
    const turnLeftKeybind = this.keybinds.find((k) => k.name === 'turnLeft');
    const turnRightKeybind = this.keybinds.find((k) => k.name === 'turnRight');

    // Vertical movement (altitude)
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      if (deltaY < -this.touchDeadZone && altitudeKeybind) {
        // Touch moved up - increase altitude
        this.touchSimulatedKeys[altitudeKeybind.currentKey] = true;
      } else if (deltaY > this.touchDeadZone && altitudeDownKeybind) {
        // Touch moved down - decrease altitude
        this.touchSimulatedKeys[altitudeDownKeybind.currentKey] = true;
      }
    } else {
      // Horizontal movement (turning)
      if (deltaX < -this.touchDeadZone && turnLeftKeybind) {
        // Touch moved left - turn left
        this.touchSimulatedKeys[turnLeftKeybind.currentKey] = true;
      } else if (deltaX > this.touchDeadZone && turnRightKeybind) {
        // Touch moved right - turn right
        this.touchSimulatedKeys[turnRightKeybind.currentKey] = true;
      }
    }
  }

  private clearTouchSimulation(): void {
    this.touchSimulatedKeys = {};
    this.touchStartPosition = null;
  }
}

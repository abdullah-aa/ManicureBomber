import { Scene } from '@babylonjs/core';

export class InputManager {
    private scene: Scene;
    private canvas: HTMLCanvasElement;
    private keys: { [key: string]: boolean } = {};
    private wheelDelta: number = 0;
    
    // Cache frequently accessed keys to reduce lookup overhead
    private cachedArrowLeft: boolean = false;
    private cachedArrowRight: boolean = false;
    private cachedShiftRight: boolean = false;
    private keyCacheValid: boolean = false;
    private lastKeyCacheUpdate: number = 0;
    private keyCacheInterval: number = 16; // Update cache every 16ms (~60fps)

    constructor(scene: Scene, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.canvas = canvas;
        this.setupKeyboardInput();
        this.setupMouseInput();
    }

    private setupMouseInput(): void {
        this.canvas.addEventListener('wheel', (event) => {
            this.wheelDelta += event.deltaY;
            event.preventDefault();
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
    }

    public isKeyPressed(key: string): boolean {
        // Cache frequently accessed keys to reduce lookup overhead during bomber turning
        const currentTime = performance.now();
        if (!this.keyCacheValid || currentTime - this.lastKeyCacheUpdate > this.keyCacheInterval) {
            this.cachedArrowLeft = this.keys['ArrowLeft'] || false;
            this.cachedArrowRight = this.keys['ArrowRight'] || false;
            this.cachedShiftRight = this.keys['ShiftRight'] || false;
            this.keyCacheValid = true;
            this.lastKeyCacheUpdate = currentTime;
        }
        
        // Use cached values for frequently accessed keys
        switch (key) {
            case 'ArrowLeft':
                return this.cachedArrowLeft;
            case 'ArrowRight':
                return this.cachedArrowRight;
            case 'ShiftRight':
                return this.cachedShiftRight;
            default:
                return this.keys[key] || false;
        }
    }

    public isBombKeyPressed(): boolean {
        return this.isKeyPressed('Slash');
    }

    public isMissileKeyPressed(): boolean {
        return this.isKeyPressed('Period');
    }

    public isCountermeasureKeyPressed(): boolean {
        return this.isKeyPressed('Comma');
    }

    public triggerBombKeyPress(): void {
        this.keys['Slash'] = true;
        // Reset after a short time to simulate a single press
        setTimeout(() => {
            this.keys['Slash'] = false;
        }, 100);
    }

    public triggerMissileKeyPress(): void {
        this.keys['Period'] = true;
        // Reset after a short time to simulate a single press
        setTimeout(() => {
            this.keys['Period'] = false;
        }, 100);
    }

    public triggerCountermeasureKeyPress(): void {
        this.keys['Comma'] = true;
        // Reset after a short time to simulate a single press
        setTimeout(() => {
            this.keys['Comma'] = false;
        }, 100);
    }

    public isShiftUpPressed(): boolean {
        return this.isKeyPressed('ShiftLeft') && this.isKeyPressed('ArrowUp') ||
               this.isKeyPressed('ShiftRight') && this.isKeyPressed('ArrowUp');
    }

    public isShiftDownPressed(): boolean {
        return this.isKeyPressed('ShiftLeft') && this.isKeyPressed('ArrowDown') ||
               this.isKeyPressed('ShiftRight') && this.isKeyPressed('ArrowDown');
    }

    public isShiftLeftBracketPressed(): boolean {
        return this.isKeyPressed('ShiftLeft') && this.isKeyPressed('BracketLeft') ||
               this.isKeyPressed('ShiftRight') && this.isKeyPressed('BracketLeft');
    }

    public isShiftRightBracketPressed(): boolean {
        return this.isKeyPressed('ShiftLeft') && this.isKeyPressed('BracketRight') ||
               this.isKeyPressed('ShiftRight') && this.isKeyPressed('BracketRight');
    }

    public isCameraTogglePressed(): boolean {
        return this.isKeyPressed('Quote');
    }

    public isRightShiftLeftPressed(): boolean {
        return this.isKeyPressed('ShiftRight') && this.isKeyPressed('ArrowLeft');
    }

    public isRightShiftRightPressed(): boolean {
        return this.isKeyPressed('ShiftRight') && this.isKeyPressed('ArrowRight');
    }

    public isCameraResetPressed(): boolean {
        return this.isKeyPressed('Semicolon');
    }

    public isCtrlUpPressed(): boolean {
        return this.isKeyPressed('ControlLeft') && this.isKeyPressed('ArrowUp') ||
               this.isKeyPressed('ControlRight') && this.isKeyPressed('ArrowUp');
    }

    public isCtrlDownPressed(): boolean {
        return this.isKeyPressed('ControlLeft') && this.isKeyPressed('ArrowDown') ||
               this.isKeyPressed('ControlRight') && this.isKeyPressed('ArrowDown');
    }

    public isAnyCtrlPressed(): boolean {
        return this.isKeyPressed('ControlLeft') || this.isKeyPressed('ControlRight');
    }

    public getKeys(): { [key: string]: boolean } {
        return { ...this.keys };
    }
} 
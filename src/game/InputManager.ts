import { Scene } from '@babylonjs/core';

export class InputManager {
    private scene: Scene;
    private canvas: HTMLCanvasElement;
    private keys: { [key: string]: boolean } = {};
    private wheelDelta: number = 0;

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
            event.preventDefault();
        });

        // Handle keyup events
        window.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
            event.preventDefault();
        });

        // Clear keys when window loses focus
        window.addEventListener('blur', () => {
            this.keys = {};
        });
    }

    public getWheelDelta(): number {
        return this.wheelDelta;
    }

    public endFrame(): void {
        this.wheelDelta = 0;
    }

    public isKeyPressed(key: string): boolean {
        return this.keys[key] || false;
    }

    public isBombKeyPressed(): boolean {
        return this.isKeyPressed('KeyB');
    }

    public isMissileKeyPressed(): boolean {
        return this.isKeyPressed('KeyM');
    }

    public triggerBombKeyPress(): void {
        this.keys['KeyB'] = true;
        // Reset after a short time to simulate a single press
        setTimeout(() => {
            this.keys['KeyB'] = false;
        }, 100);
    }

    public triggerMissileKeyPress(): void {
        this.keys['KeyM'] = true;
        // Reset after a short time to simulate a single press
        setTimeout(() => {
            this.keys['KeyM'] = false;
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

    public isCameraTogglePressed(): boolean {
        return this.isKeyPressed('KeyV');
    }

    public getKeys(): { [key: string]: boolean } {
        return { ...this.keys };
    }
} 